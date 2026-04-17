/**
 * Engine tick — colony growth, upkeep, passive extraction, tax collection,
 * and sol stipend.
 *
 * Step order:
 *   1.  Fetch active colonies
 *   2.  Fetch station id
 *   3.  Fetch station resources (iron, food, biomass, water)
 *   4.  Fetch active structures per colony
 *   5.  Fetch player research
 *   5.5 Batch-fetch survey results
 *   5.6 Fetch body stewardship + permits (for permit tax)
 *   6.  Colony growth resolution
 *   6.5 Biomass → food auto-conversion
 *   7.  Upkeep resolution
 *   8.  Persist station resource changes
 *   8.5 Passive extraction (with permit tax deduction)
 *   9.  Auto-collect colony tax credits
 *   10. Sol stipend check
 */

import { getCatalogEntry } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import { applyGrowthResolution, calculateAccumulatedTax } from "@/lib/game/taxes";
import {
  upkeepPeriodsToResolve,
  resolveColonyUpkeep,
  isGrowthBlocked,
  effectiveUpkeepFoodRequired,
  extractionMultiplier,
} from "@/lib/game/colonyUpkeep";
import { isHarshPlanetType } from "@/lib/game/habitability";
import {
  getStructureTier,
  researchLevel,
  upkeepReductionFraction,
  extractionBonusMultiplier,
  effectiveStorageCap,
} from "@/lib/game/colonyStructures";
import { calculateAccumulatedExtraction } from "@/lib/game/extraction";
import { BALANCE } from "@/lib/config/balance";
import type { BodyType } from "@/lib/types/enums";
import type { Colony, Structure, ResourceNodeRecord } from "@/lib/types/game";

export interface EngineTickResult {
  coloniesGrown: number;
  upkeepPeriodsResolved: number;
  ironConsumed: number;
  foodConsumed: number;
  biomassConverted: number;
  creditsCollected: number;
  stipendGranted: boolean;
}

/**
 * Resolves colony growth, upkeep, biomass→food conversion, passive
 * extraction, tax collection, and the sol stipend for a player.
 *
 * Safe to call multiple times (lazy/idempotent by design).
 */
export async function runEngineTick(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  playerId: string,
  requestTime: Date = new Date(),
): Promise<EngineTickResult> {
  // ── 1. Fetch colonies ──────────────────────────────────────────────────────
  const { data: rawColonies } = await admin
    .from("colonies")
    .select("*")
    .eq("owner_id", playerId)
    .eq("status", "active");

  const colonies: Colony[] = rawColonies ?? [];
  if (colonies.length === 0) {
    // Still run sol stipend for players with no colonies (prevents softlock).
    const { creditsCollected, stipendGranted } = await applyCreditsTick(
      admin, playerId, 0, requestTime,
    );
    return {
      coloniesGrown: 0, upkeepPeriodsResolved: 0, ironConsumed: 0,
      foodConsumed: 0, biomassConverted: 0, creditsCollected, stipendGranted,
    };
  }

  // ── 2. Fetch station ───────────────────────────────────────────────────────
  const { data: stationRow } = await admin
    .from("player_stations")
    .select("id")
    .eq("owner_id", playerId)
    .maybeSingle();

  const stationId: string | null = stationRow?.id ?? null;

  // ── 3. Fetch station resources (iron, food, biomass, water) ────────────────
  let stationIron = 0;
  let stationFood = 0;
  let stationBiomass = 0;
  let stationWater = 0;

  if (stationId) {
    const { data: invRows } = await admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "station")
      .eq("location_id", stationId)
      .in("resource_type", ["iron", "food", "biomass", "water"]);

    for (const row of (invRows ?? []) as { resource_type: string; quantity: number }[]) {
      if (row.resource_type === "iron")    stationIron    = row.quantity;
      if (row.resource_type === "food")    stationFood    = row.quantity;
      if (row.resource_type === "biomass") stationBiomass = row.quantity;
      if (row.resource_type === "water")   stationWater   = row.quantity;
    }
  }

  // ── 4. Fetch active structures per colony ──────────────────────────────────
  const colonyIds = colonies.map((c) => c.id);
  const { data: structureRows } = await admin
    .from("structures")
    .select("id, colony_id, type, tier, is_active")
    .in("colony_id", colonyIds)
    .eq("is_active", true);

  const structuresByColonyId = new Map<string, Pick<Structure, "id" | "colony_id" | "type" | "tier" | "is_active">[]>();
  for (const row of (structureRows ?? []) as Pick<Structure, "id" | "colony_id" | "type" | "tier" | "is_active">[]) {
    const list = structuresByColonyId.get(row.colony_id) ?? [];
    list.push(row);
    structuresByColonyId.set(row.colony_id, list);
  }

  // ── 5. Fetch player research ───────────────────────────────────────────────
  const { data: researchRows } = await admin
    .from("player_research")
    .select("research_id")
    .eq("player_id", playerId);

  const unlockedResearchIds = new Set(
    ((researchRows ?? []) as { research_id: string }[]).map((r) => r.research_id),
  );
  const sustainabilityResearchLvl = researchLevel(unlockedResearchIds, "sustainability");
  const extractionResearchLvl    = researchLevel(unlockedResearchIds, "extraction");
  const storageResearchLvl       = researchLevel(unlockedResearchIds, "storage");

  // ── 5.5. Batch-fetch survey results for all colony body ids ────────────────
  const bodyIds = colonies.map((c) => c.body_id);
  const { data: surveyRows } = await admin
    .from("survey_results")
    .select("body_id, resource_nodes")
    .in("body_id", bodyIds);

  const surveyByBodyId = new Map<string, { resource_nodes: ResourceNodeRecord[] }>();
  for (const row of (surveyRows ?? []) as { body_id: string; resource_nodes: ResourceNodeRecord[] }[]) {
    surveyByBodyId.set(row.body_id, row);
  }

  // ── 5.6. Fetch stewardship and permits for permit tax enforcement ──────────
  // For colonies where another player is the steward, check if this player
  // has an active permit and what tax rate applies.
  type StewardRow = { body_id: string; steward_id: string };
  type PermitRow  = { body_id: string; steward_id: string; tax_rate_pct: number };

  const { data: stewardshipRows } = await admin
    .from("body_stewardship")
    .select("body_id, steward_id")
    .in("body_id", bodyIds);

  const stewardByBodyId = new Map<string, string>(
    ((stewardshipRows ?? []) as StewardRow[]).map((r) => [r.body_id, r.steward_id]),
  );

  // Colonies where someone else is the steward (this player is a grantee)
  const permittedBodyIds = colonies
    .filter((c) => {
      const stewardId = stewardByBodyId.get(c.body_id);
      return stewardId && stewardId !== playerId;
    })
    .map((c) => c.body_id);

  const permitByBodyId = new Map<string, PermitRow>();
  if (permittedBodyIds.length > 0) {
    const { data: permitRows } = await admin
      .from("colony_permits")
      .select("body_id, steward_id, tax_rate_pct")
      .in("body_id", permittedBodyIds)
      .eq("grantee_id", playerId)
      .eq("status", "active");

    for (const p of (permitRows ?? []) as PermitRow[]) {
      permitByBodyId.set(p.body_id, p);
    }
  }

  // ── 6. Growth resolution ──────────────────────────────────────────────────
  const growthUpdates: { id: string; tier: number; next_growth_at: string | null }[] = [];
  const resolvedColonies: Colony[] = colonies.map((colony) => {
    if (!colony.next_growth_at) return colony;
    if (isGrowthBlocked(colony.upkeep_missed_periods)) return colony;
    const { colony: resolved, resolution } = applyGrowthResolution(colony, requestTime);
    if (resolution.tiersGained > 0) {
      growthUpdates.push({
        id: colony.id,
        tier: resolved.population_tier,
        next_growth_at: resolved.next_growth_at,
      });
    }
    return resolved;
  });

  if (growthUpdates.length > 0) {
    await Promise.all(
      growthUpdates.map(({ id, tier, next_growth_at }) =>
        admin
          .from("colonies")
          .update({ population_tier: tier, next_growth_at })
          .eq("id", id),
      ),
    );
  }

  // ── 6.5. Biomass → food auto-conversion (pre-upkeep shortfall fill) ────────
  let totalBiomassConverted = 0;

  {
    let totalFoodNeeded = 0;
    for (const colony of resolvedColonies) {
      const periods = upkeepPeriodsToResolve(colony.last_upkeep_at, requestTime);
      if (periods === 0) continue;
      const colonyStructures = (structuresByColonyId.get(colony.id) ?? []) as Structure[];
      const habitatTier = getStructureTier(colonyStructures, "habitat_module");
      const reductionFrac = upkeepReductionFraction(habitatTier, sustainabilityResearchLvl);
      totalFoodNeeded += effectiveUpkeepFoodRequired(colony.population_tier, reductionFrac) * periods;
    }

    const foodShortfall = Math.max(0, totalFoodNeeded - stationFood);
    if (foodShortfall > 0 && stationBiomass > 0 && stationWater > 0) {
      const canConvert = Math.min(stationBiomass, stationWater, foodShortfall);
      if (canConvert > 0) {
        stationBiomass -= canConvert;
        stationWater   -= canConvert;
        stationFood    += canConvert;
        totalBiomassConverted = canConvert;
      }
    }
  }

  // ── 7. Upkeep resolution ───────────────────────────────────────────────────
  let totalIronConsumed = 0;
  let totalFoodConsumed = 0;
  let totalPeriodsResolved = 0;

  for (let ci = 0; ci < resolvedColonies.length; ci++) {
    const colony = resolvedColonies[ci];
    const periods = upkeepPeriodsToResolve(colony.last_upkeep_at, requestTime);
    if (periods === 0) continue;

    const colonyStructures = (structuresByColonyId.get(colony.id) ?? []) as Structure[];
    const habitatTier = getStructureTier(colonyStructures, "habitat_module");
    const reductionFrac = upkeepReductionFraction(habitatTier, sustainabilityResearchLvl);

    const planetType = colonyPlanetType(colony.body_id);
    const isHarsh = planetType !== null && isHarshPlanetType(planetType);

    const result = resolveColonyUpkeep(
      colony,
      periods,
      stationFood,
      stationIron,
      isHarsh,
      requestTime,
      reductionFrac,
    );

    if (result.foodConsumed > 0) {
      stationFood -= result.foodConsumed;
      totalFoodConsumed += result.foodConsumed;
    }
    if (result.ironConsumed > 0) {
      stationIron -= result.ironConsumed;
      totalIronConsumed += result.ironConsumed;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upkeepPatch: Record<string, any> = {
      last_upkeep_at: result.newLastUpkeepAt,
      upkeep_missed_periods: result.newMissedPeriods,
    };
    if (result.newTier !== colony.population_tier) {
      upkeepPatch.population_tier = result.newTier;
      upkeepPatch.next_growth_at = result.newNextGrowthAt;
    }

    await admin.from("colonies").update(upkeepPatch).eq("id", colony.id);
    totalPeriodsResolved += periods;
  }

  // ── 8. Persist station resource changes ───────────────────────────────────
  if (stationId) {
    if (totalFoodConsumed > 0 || totalBiomassConverted > 0) {
      await persistStationResource(admin, stationId, "food", stationFood);
    }
    if (totalIronConsumed > 0) {
      await persistStationResource(admin, stationId, "iron", stationIron);
    }
    if (totalBiomassConverted > 0) {
      await persistStationResource(admin, stationId, "biomass", stationBiomass);
      await persistStationResource(admin, stationId, "water",   stationWater);
    }
  }

  // ── 8.5. Passive extraction — materialise colony inventory ─────────────────
  for (const colony of resolvedColonies) {
    const survey = surveyByBodyId.get(colony.body_id);
    if (!survey || survey.resource_nodes.length === 0) continue;

    const colonyStructures = (structuresByColonyId.get(colony.id) ?? []) as Structure[];
    const extractorTier  = getStructureTier(colonyStructures, "extractor");
    const extBonusMult   = extractionBonusMultiplier(extractorTier, extractionResearchLvl);
    const healthMult     = extractionMultiplier(colony.upkeep_missed_periods);
    const lastExtractAt  = colony.last_extract_at ?? colony.created_at;

    const rawAmounts = calculateAccumulatedExtraction(
      survey.resource_nodes,
      colony.population_tier,
      lastExtractAt,
      requestTime,
      extBonusMult,
    );

    const amounts = rawAmounts
      .map((item) => ({ ...item, quantity: Math.floor(item.quantity * healthMult) }))
      .filter((item) => item.quantity > 0);

    if (amounts.length === 0) continue;

    // Reset last_extract_at first (safer: lose resources rather than double-extract).
    await admin
      .from("colonies")
      .update({ last_extract_at: requestTime.toISOString() })
      .eq("id", colony.id);

    const { data: existingRows } = await admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "colony")
      .eq("location_id", colony.id);

    const allExisting = ((existingRows ?? []) as { resource_type: string; quantity: number }[]);
    const existing    = new Map(allExisting.map((r) => [r.resource_type, r.quantity]));

    const warehouseTier = getStructureTier(colonyStructures, "warehouse");
    const storageCap    = effectiveStorageCap(colony.storage_cap, warehouseTier, storageResearchLvl);
    const currentTotal  = allExisting.reduce((sum, r) => sum + r.quantity, 0);
    const headroom      = Math.max(0, storageCap - currentTotal);

    if (headroom <= 0) continue;

    let headroomLeft = headroom;
    let finalAmounts = amounts
      .map((item) => {
        const qty = Math.min(item.quantity, headroomLeft);
        headroomLeft = Math.max(0, headroomLeft - qty);
        return { ...item, quantity: qty };
      })
      .filter((item) => item.quantity > 0);

    if (finalAmounts.length === 0) continue;

    // ── Permit tax: deduct steward's share from extracted resources ──────────
    const permit = permitByBodyId.get(colony.body_id);
    if (permit && permit.tax_rate_pct > 0) {
      const taxRate = permit.tax_rate_pct / 100;
      const taxAmounts: Array<{ resource_type: string; quantity: number }> = [];

      finalAmounts = finalAmounts
        .map((item) => {
          const taxQty = Math.floor(item.quantity * taxRate);
          if (taxQty > 0) {
            taxAmounts.push({ resource_type: item.resource_type, quantity: taxQty });
          }
          return { ...item, quantity: item.quantity - taxQty };
        })
        .filter((item) => item.quantity > 0);

      if (taxAmounts.length > 0) {
        // Fire-and-forget: deposit tax into steward's station (best-effort)
        void depositPermitTax(admin, permit.steward_id, taxAmounts).catch(() => undefined);
      }
    }

    if (finalAmounts.length === 0) continue;

    await admin
      .from("resource_inventory")
      .upsert(
        finalAmounts.map((item) => ({
          location_type: "colony",
          location_id:   colony.id,
          resource_type: item.resource_type,
          quantity: (existing.get(item.resource_type) ?? 0) + item.quantity,
        })),
        { onConflict: "location_type,location_id,resource_type" },
      );
  }

  // ── 9. Auto-collect colony tax credits ────────────────────────────────────
  // Lazily compute accumulated credits for each active colony and sum them up.
  // Timer is reset FIRST (lose credits on failure rather than double-collect).
  let totalTaxCollected = 0;
  const taxColonyIds: string[] = [];

  for (const colony of resolvedColonies) {
    const rawTax = calculateAccumulatedTax(
      colony.last_tax_collected_at,
      colony.population_tier,
      requestTime,
    );
    if (rawTax <= 0) continue;

    // Health multiplier mirrors extraction (struggling/neglected colonies earn less).
    const healthMult = extractionMultiplier(colony.upkeep_missed_periods);
    const finalTax   = Math.floor(rawTax * healthMult);
    if (finalTax <= 0) continue;

    totalTaxCollected += finalTax;
    taxColonyIds.push(colony.id);
  }

  if (taxColonyIds.length > 0) {
    await Promise.all(
      taxColonyIds.map((id) =>
        admin
          .from("colonies")
          .update({ last_tax_collected_at: requestTime.toISOString() })
          .eq("id", id),
      ),
    );
  }

  // ── 10. Credit update + sol stipend ──────────────────────────────────────
  const { creditsCollected, stipendGranted } = await applyCreditsTick(
    admin, playerId, totalTaxCollected, requestTime,
  );

  return {
    coloniesGrown:         growthUpdates.length,
    upkeepPeriodsResolved: totalPeriodsResolved,
    ironConsumed:          totalIronConsumed,
    foodConsumed:          totalFoodConsumed,
    biomassConverted:      totalBiomassConverted,
    creditsCollected,
    stipendGranted,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Upsert or delete a resource row in station inventory. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function persistStationResource(admin: any, stationId: string, resourceType: string, newQty: number) {
  if (newQty <= 0) {
    await admin
      .from("resource_inventory")
      .delete()
      .eq("location_type", "station")
      .eq("location_id", stationId)
      .eq("resource_type", resourceType);
  } else {
    await admin
      .from("resource_inventory")
      .upsert(
        [{ location_type: "station", location_id: stationId, resource_type: resourceType, quantity: newQty }],
        { onConflict: "location_type,location_id,resource_type" },
      );
  }
}

/** Derive planet type from a body_id (deterministic — no DB needed). */
function colonyPlanetType(bodyId: string): BodyType | null {
  const lastColon = bodyId.lastIndexOf(":");
  if (lastColon === -1) return null;
  const sysId = bodyId.slice(0, lastColon);
  const bIdx  = parseInt(bodyId.slice(lastColon + 1), 10);
  if (isNaN(bIdx)) return null;
  const catEntry = getCatalogEntry(sysId);
  const sys = generateSystem(sysId, catEntry ?? undefined);
  return sys.bodies[bIdx]?.type ?? null;
}

/**
 * Apply accumulated tax credits and check the sol stipend in a single player
 * update. Fetches current credits once, adds tax + stipend if due, writes once.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyCreditsTick(
  admin: any,
  playerId: string,
  taxCredits: number,
  now: Date,
): Promise<{ creditsCollected: number; stipendGranted: boolean }> {
  const { data: row } = await admin
    .from("players")
    .select("credits, sol_stipend_last_at")
    .eq("id", playerId)
    .maybeSingle();

  const currentCredits: number    = row?.credits ?? 0;
  const lastStipendAt: string | null = row?.sol_stipend_last_at ?? null;

  let stipendGrant = 0;
  let newStipendAt: string | null = null;

  // Grant the stipend only when the projected balance stays at or below the
  // threshold AND at least 24 hours have passed since the last grant.
  const projectedBalance = currentCredits + taxCredits;
  if (projectedBalance <= BALANCE.solStipend.creditThreshold) {
    const lastMs     = lastStipendAt ? new Date(lastStipendAt).getTime() : 0;
    const msElapsed  = now.getTime() - lastMs;
    if (msElapsed >= 24 * 60 * 60 * 1000) {
      stipendGrant = BALANCE.solStipend.dailyCredits;
      newStipendAt = now.toISOString();
    }
  }

  const totalDelta = taxCredits + stipendGrant;
  if (totalDelta > 0 || newStipendAt) {
    const patch: Record<string, unknown> = { credits: currentCredits + totalDelta };
    if (newStipendAt) patch.sol_stipend_last_at = newStipendAt;
    await admin.from("players").update(patch).eq("id", playerId);
  }

  return { creditsCollected: taxCredits, stipendGranted: stipendGrant > 0 };
}

/**
 * Deposit permit tax resources into the steward's station inventory.
 * Fire-and-forget — caller should void + catch so failures don't block ticks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function depositPermitTax(
  admin: any,
  stewardId: string,
  resources: Array<{ resource_type: string; quantity: number }>,
): Promise<void> {
  if (resources.length === 0) return;

  const { data: stationRow } = await admin
    .from("player_stations")
    .select("id")
    .eq("owner_id", stewardId)
    .maybeSingle();

  const sid: string | null = stationRow?.id ?? null;
  if (!sid) return;

  // Fetch existing quantities so we can add rather than overwrite.
  const resourceTypes = resources.map((r) => r.resource_type);
  const { data: existingRows } = await admin
    .from("resource_inventory")
    .select("resource_type, quantity")
    .eq("location_type", "station")
    .eq("location_id", sid)
    .in("resource_type", resourceTypes);

  const existing = new Map(
    ((existingRows ?? []) as { resource_type: string; quantity: number }[])
      .map((r) => [r.resource_type, r.quantity]),
  );

  await admin
    .from("resource_inventory")
    .upsert(
      resources.map((r) => ({
        location_type: "station",
        location_id:   sid,
        resource_type: r.resource_type,
        quantity:      (existing.get(r.resource_type) ?? 0) + r.quantity,
      })),
      { onConflict: "location_type,location_id,resource_type" },
    );
}
