/**
 * Engine tick — colony growth and upkeep resolution.
 *
 * Extracted from command/page.tsx Steps 4 and 4.5.
 * Called directly by the command page (server component) and also exposed as
 * POST /api/engine/tick for client-side or tooling use.
 *
 * The function reads all needed state fresh from the DB, runs the resolution
 * logic, writes updates, and returns a summary. This means the command page
 * can call it before its own data fetches and see fully-resolved state.
 */

import { getCatalogEntry } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import { applyGrowthResolution } from "@/lib/game/taxes";
import {
  upkeepPeriodsToResolve,
  resolveColonyUpkeep,
  isGrowthBlocked,
} from "@/lib/game/colonyUpkeep";
import { isHarshPlanetType } from "@/lib/game/habitability";
import {
  getStructureTier,
  researchLevel,
  upkeepReductionFraction,
} from "@/lib/game/colonyStructures";
import type { BodyType } from "@/lib/types/enums";
import type { Colony, Structure } from "@/lib/types/game";

export interface EngineTickResult {
  coloniesGrown: number;
  upkeepPeriodsResolved: number;
  ironConsumed: number;
  foodConsumed: number;
}

/**
 * Resolves colony growth and upkeep for a player.
 *
 * Reads colonies, station inventory, structures, and research from the DB,
 * then applies all overdue growth ticks and upkeep periods, and writes the
 * results back. Safe to call multiple times (lazy/idempotent by design).
 *
 * @param admin  Service-role Supabase client (bypasses RLS)
 * @param playerId  The player's UUID
 * @param requestTime  Timestamp to treat as "now" (pass new Date() normally)
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
    return { coloniesGrown: 0, upkeepPeriodsResolved: 0, ironConsumed: 0, foodConsumed: 0 };
  }

  // ── 2. Fetch station ───────────────────────────────────────────────────────
  const { data: stationRow } = await admin
    .from("player_stations")
    .select("id")
    .eq("owner_id", playerId)
    .maybeSingle();

  const stationId: string | null = stationRow?.id ?? null;

  // ── 3. Fetch station iron and food ─────────────────────────────────────────
  let stationIron = 0;
  let stationFood = 0;

  if (stationId) {
    const { data: invRows } = await admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "station")
      .eq("location_id", stationId)
      .in("resource_type", ["iron", "food"]);

    for (const row of (invRows ?? []) as { resource_type: string; quantity: number }[]) {
      if (row.resource_type === "iron") stationIron = row.quantity;
      if (row.resource_type === "food") stationFood = row.quantity;
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

  // ── 5. Fetch player research for sustainability level ─────────────────────
  const { data: researchRows } = await admin
    .from("player_research")
    .select("research_id")
    .eq("player_id", playerId);

  const unlockedResearchIds = new Set(
    ((researchRows ?? []) as { research_id: string }[]).map((r) => r.research_id),
  );
  const sustainabilityResearchLvl = researchLevel(unlockedResearchIds, "sustainability");

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
    if (totalFoodConsumed > 0) {
      await persistStationResource(admin, stationId, "food", stationFood);
    }
    if (totalIronConsumed > 0) {
      await persistStationResource(admin, stationId, "iron", stationIron);
    }
  }

  return {
    coloniesGrown: growthUpdates.length,
    upkeepPeriodsResolved: totalPeriodsResolved,
    ironConsumed: totalIronConsumed,
    foodConsumed: totalFoodConsumed,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  const bIdx = parseInt(bodyId.slice(lastColon + 1), 10);
  if (isNaN(bIdx)) return null;
  const catEntry = getCatalogEntry(sysId);
  const sys = generateSystem(sysId, catEntry ?? undefined);
  return sys.bodies[bIdx]?.type ?? null;
}
