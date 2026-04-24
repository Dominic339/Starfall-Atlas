/**
 * GET /api/game/colony/panel?systemId=XXX
 *
 * Returns full colony panel summary data for all of the current player's
 * colonies in the given system.  Used by the map-overlay ColonyMapPanel.
 */

import { type NextRequest } from "next/server";
import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { systemDisplayName, getCatalogEntry } from "@/lib/catalog";
import { calculateAccumulatedTax } from "@/lib/game/taxes";
import {
  colonyHealthStatus,
  upkeepDescription,
  extractionMultiplier,
} from "@/lib/game/colonyUpkeep";
import { isHarshPlanetType } from "@/lib/game/habitability";
import {
  getStructureTier,
  researchLevel,
  upkeepReductionFraction,
  effectiveStorageCap,
  structureBuildCost,
  extractionBonusMultiplier,
} from "@/lib/game/colonyStructures";
import { extractionRatePerNode } from "@/lib/game/extraction";
import { BALANCE } from "@/lib/config/balance";
import type {
  Colony,
  Structure,
  PlayerStation,
  ResourceInventoryRow,
  PlayerResearch,
  SurveyResult,
  Ship,
} from "@/lib/types/game";
import type { BodyType } from "@/lib/types/enums";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const systemId = request.nextUrl.searchParams.get("systemId");
  if (!systemId) {
    return Response.json({ ok: false, error: { code: "validation_error", message: "systemId required" } }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: coloniesRaw } = await admin
    .from("colonies")
    .select("*")
    .eq("owner_id", player.id)
    .eq("system_id", systemId);

  const colonies = (coloniesRaw ?? []) as Colony[];

  if (colonies.length === 0) {
    return Response.json({
      ok: true,
      data: { colonies: [], playerCredits: player.credits, stationIron: 0 },
    });
  }

  const euxSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [researchRes, stationRes, shipsRes, euxUsageRes] = await Promise.all([
    admin.from("player_research").select("research_id").eq("player_id", player.id),
    admin.from("player_stations").select("*").eq("owner_id", player.id).maybeSingle(),
    admin
      .from("ships")
      .select("id, name, cargo_cap, dispatch_mode, auto_state, pinned_colony_id")
      .eq("owner_id", player.id)
      .eq("current_system_id", systemId),
    admin
      .from("universal_exchange_purchases")
      .select("quantity")
      .eq("player_id", player.id)
      .gte("purchased_at", euxSince),
  ]);

  const unlockedResearchIds = new Set(
    (listResult<Pick<PlayerResearch, "research_id">>(researchRes).data ?? []).map(
      (r) => r.research_id,
    ),
  );
  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;
  const shipsAtSystem = (shipsRes.data ?? []) as Pick<
    Ship,
    "id" | "name" | "cargo_cap" | "dispatch_mode" | "auto_state" | "pinned_colony_id"
  >[];
  const euxDailyUsed = (euxUsageRes.data ?? []).reduce(
    (s: number, r: { quantity: number }) => s + r.quantity,
    0,
  );

  let stationIron = 0;
  if (station) {
    const { data: ironRow } = await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron")
      .maybeSingle();
    stationIron = (ironRow as { quantity: number } | null)?.quantity ?? 0;
  }

  const sustainabilityLvl = researchLevel(unlockedResearchIds, "sustainability");
  const storageLvl = researchLevel(unlockedResearchIds, "storage");
  const extractionLvl = researchLevel(unlockedResearchIds, "extraction");

  const euxOptions = (["iron", "carbon", "ice"] as const).map((rt) => {
    const floor = BALANCE.emergencyExchange.floorPricePerUnit[rt] ?? 5;
    return {
      resourceType: rt,
      pricePerUnit: Math.ceil(
        floor *
          BALANCE.emergencyExchange.markupMultiplier *
          (1 + BALANCE.emergencyExchange.transactionFeePercent / 100),
      ),
    };
  });

  const catalogEntry = getCatalogEntry(systemId);
  let generatedBodies: { type: string }[] = [];
  if (catalogEntry) {
    const { generateSystem } = await import("@/lib/game/generation");
    generatedBodies = generateSystem(systemId, catalogEntry).bodies;
  }

  const now = new Date();
  const systemName = systemDisplayName(systemId);

  const colonySummaries = await Promise.all(
    colonies.map(async (colony) => {
      const [invRes, structuresRes, surveyRes] = await Promise.all([
        admin
          .from("resource_inventory")
          .select("resource_type, quantity")
          .eq("location_type", "colony")
          .eq("location_id", colony.id)
          .order("resource_type"),
        admin
          .from("structures")
          .select("id, colony_id, type, tier, is_active")
          .eq("colony_id", colony.id)
          .eq("is_active", true),
        admin
          .from("survey_results")
          .select("resource_nodes")
          .eq("body_id", colony.body_id)
          .maybeSingle(),
      ]);

      const inventory = (invRes.data ?? []) as Pick<
        ResourceInventoryRow,
        "resource_type" | "quantity"
      >[];
      const structures = (structuresRes.data ?? []) as Structure[];
      const survey =
        (surveyRes.data as Pick<SurveyResult, "resource_nodes"> | null) ?? null;
      const resourceNodes = survey?.resource_nodes ?? [];

      const bodyIndex = parseInt(colony.body_id.split(":")[1] ?? "0", 10);
      const planetType = (generatedBodies[bodyIndex - 1]?.type ?? null) as BodyType | null;
      const isHarsh = planetType ? isHarshPlanetType(planetType) : false;

      const warehouseTier = getStructureTier(structures, "warehouse");
      const habitatTier = getStructureTier(structures, "habitat_module");
      const extractorTier = getStructureTier(structures, "extractor");
      const upkeepRedFrac = upkeepReductionFraction(habitatTier, sustainabilityLvl);
      const storageCap = effectiveStorageCap(colony.storage_cap, warehouseTier, storageLvl);

      const health = colonyHealthStatus(colony.upkeep_missed_periods);
      const healthMult = extractionMultiplier(colony.upkeep_missed_periods);
      const upkeepDesc = upkeepDescription(colony.population_tier, isHarsh, upkeepRedFrac);

      const accruedTax = calculateAccumulatedTax(
        colony.last_tax_collected_at,
        colony.population_tier,
        now,
      );

      const extBonusMult = extractionBonusMultiplier(extractorTier, extractionLvl);
      const basicNodeCount = resourceNodes.filter(
        (n: { is_rare: boolean }) => !n.is_rare,
      ).length;
      const totalRatePerHr = Math.floor(
        extractionRatePerNode(colony.population_tier) *
          basicNodeCount *
          extBonusMult *
          healthMult,
      );
      const lastExtractAt = colony.last_extract_at ?? colony.created_at;
      const elapsedHours =
        (now.getTime() - new Date(lastExtractAt).getTime()) / (1000 * 60 * 60);
      const isCapped = elapsedHours >= BALANCE.extraction.accumulationCapHours;

      const buildTypes = ["warehouse", "extractor", "habitat_module"] as const;
      const buildOptions = buildTypes.map((type) => {
        const currentTier = getStructureTier(structures, type);
        const targetTier = currentTier + 1;
        const atMax = currentTier >= BALANCE.structures.maxTier;
        const cost = atMax ? null : structureBuildCost(targetTier);
        return {
          type,
          currentTier,
          targetTier,
          cost,
          canAfford: cost ? stationIron >= cost.iron : false,
          atMax,
        };
      });

      let growthLabel: string | null = null;
      if (colony.status === "active") {
        if (!colony.next_growth_at) {
          growthLabel = "Max tier";
        } else if (colony.upkeep_missed_periods >= 1) {
          growthLabel = "Growth paused";
        } else {
          const growthDate = new Date(colony.next_growth_at);
          growthLabel = `Grows ${growthDate > now ? growthDate.toLocaleDateString() : "soon"}`;
        }
      }

      return {
        id: colony.id,
        systemId: colony.system_id,
        bodyId: colony.body_id,
        bodyIndex,
        systemName,
        planetType: planetType as string | null,
        isHarsh,
        status: colony.status as "active" | "abandoned" | "collapsed",
        populationTier: colony.population_tier,
        health,
        healthPct: Math.round(healthMult * 100),
        growthLabel,
        upkeepMissedPeriods: colony.upkeep_missed_periods,
        upkeepDesc,
        accruedTax,
        inventoryTotal: inventory.reduce((s, r) => s + r.quantity, 0),
        inventory: inventory.map((r) => ({
          resourceType: r.resource_type,
          quantity: r.quantity,
        })),
        storageCap,
        totalRatePerHr,
        basicNodeCount,
        extractorTier,
        warehouseTier,
        habitatTier,
        isCapped,
        buildOptions,
        shipsInSystem: shipsAtSystem.map((s) => ({
          id: s.id,
          name: s.name,
          cargoCap: s.cargo_cap,
          isAssigned: s.pinned_colony_id === colony.id,
        })),
        euxOptions,
        euxDailyUsed,
        euxDailyLimit: BALANCE.emergencyExchange.dailyLimitUnits,
        abandonedAt: colony.abandoned_at ?? null,
        resolutionWindowDays: BALANCE.inactivity.resolutionWindowDays,
      };
    }),
  );

  return Response.json({
    ok: true,
    data: {
      colonies: colonySummaries,
      playerCredits: player.credits,
      stationIron,
    },
  });
}
