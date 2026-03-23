/**
 * /game/colony/[id] — Dedicated Colony page.
 *
 * Shows a colony's current state: tier, health, inventory,
 * structures, growth timeline, and actions (collect tax, build).
 *
 * The colony is a production node in the logistics chain:
 *   - Produces resources (extraction) and tax (credits)
 *   - Requires food (and iron on harsh worlds) shipped from the station
 *   - Ships haul colony inventory back to the station
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { systemDisplayName, getCatalogEntry } from "@/lib/catalog";
import { calculateAccumulatedTax } from "@/lib/game/taxes";
import { calculateAccumulatedExtraction, formatExtractionSummary } from "@/lib/game/extraction";
import { colonyHealthStatus, upkeepDescription } from "@/lib/game/colonyUpkeep";
import { isHarshPlanetType } from "@/lib/game/habitability";
import {
  getStructureTier,
  researchLevel,
  extractionBonusMultiplier,
  upkeepReductionFraction,
  effectiveStorageCap,
  structureBuildCost,
} from "@/lib/game/colonyStructures";
import { BALANCE } from "@/lib/config/balance";
import type {
  Player,
  Colony,
  Structure,
  PlayerStation,
  ResourceInventoryRow,
  ResourceNodeRecord,
  SurveyResult,
  PlayerResearch,
} from "@/lib/types/game";
import { CollectButton, ExtractButton } from "../../_components/ColonyActions";
import { BuildStructureButton } from "../../_components/ColonyStructures";
import type { BodyType } from "@/lib/types/enums";

export const dynamic = "force-dynamic";

function bodyTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    lush: "Lush", ocean: "Ocean", desert: "Desert", ice_planet: "Ice",
    volcanic: "Volcanic", toxic: "Toxic", rocky: "Rocky", habitable: "Habitable",
    barren: "Barren", frozen: "Frozen", gas_giant: "Gas Giant",
    ice_giant: "Ice Giant", asteroid_belt: "Asteroid Belt",
  };
  return labels[type] ?? type;
}

export default async function ColonyPage({ params }: { params: { id: string } }) {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  const { data: colony } = maybeSingleResult<Colony>(
    await admin
      .from("colonies")
      .select("*")
      .eq("id", params.id)
      .eq("owner_id", player.id)
      .maybeSingle(),
  );
  if (!colony) notFound();

  // Parallel data fetches
  const [surveyRes, invRes, structuresRes, stationRes, researchRes] = await Promise.all([
    admin
      .from("survey_results")
      .select("body_id, resource_nodes")
      .eq("body_id", colony.body_id)
      .maybeSingle(),
    admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "colony")
      .eq("location_id", colony.id)
      .order("resource_type", { ascending: true }),
    admin
      .from("structures")
      .select("id, colony_id, type, tier, is_active")
      .eq("colony_id", colony.id)
      .eq("is_active", true),
    admin.from("player_stations").select("*").eq("owner_id", player.id).maybeSingle(),
    admin.from("player_research").select("research_id").eq("player_id", player.id),
  ]);

  const survey = maybeSingleResult<Pick<SurveyResult, "body_id" | "resource_nodes">>(surveyRes).data;
  const colonyInventory = (invRes.data ?? []) as Pick<ResourceInventoryRow, "resource_type" | "quantity">[];
  const structures = (structuresRes.data ?? []) as Structure[];
  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;
  const unlockedResearchIds = new Set(
    (listResult<Pick<PlayerResearch, "research_id">>(researchRes).data ?? []).map(
      (r) => r.research_id,
    ),
  );

  // Get station iron for "can afford" check
  let stationIron = 0;
  if (station) {
    const { data: stationInv } = await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron")
      .maybeSingle();
    stationIron = (stationInv as { quantity: number } | null)?.quantity ?? 0;
  }

  // Compute accrued tax
  const now = new Date();
  const accrued = calculateAccumulatedTax(colony.last_tax_collected_at, colony.population_tier, now);

  // Compute extraction
  const extractionResearchLvl = researchLevel(unlockedResearchIds, "extraction");
  const sustainabilityResearchLvl = researchLevel(unlockedResearchIds, "sustainability");
  const storageResearchLvl = researchLevel(unlockedResearchIds, "storage");
  const extractorTier = getStructureTier(structures, "extractor");
  const warehouseTier = getStructureTier(structures, "warehouse");
  const habitatTier = getStructureTier(structures, "habitat_module");
  const bonusMult = extractionBonusMultiplier(extractorTier, extractionResearchLvl);
  const upkeepRedFrac = upkeepReductionFraction(habitatTier, sustainabilityResearchLvl);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _storageCap = effectiveStorageCap(colony.storage_cap, warehouseTier, storageResearchLvl);
  const resourceNodes = (survey?.resource_nodes ?? []) as ResourceNodeRecord[];
  const accruedExtraction = calculateAccumulatedExtraction(
    resourceNodes,
    colony.population_tier,
    colony.last_extract_at ?? colony.created_at,
    now,
    bonusMult,
  );
  const extractSummary = formatExtractionSummary(accruedExtraction);

  // Planet type (needed for isHarsh)
  const catalogEntry = getCatalogEntry(colony.system_id);
  const bodyIndex = parseInt(colony.body_id.split(":")[1] ?? "0", 10);
  let planetType: BodyType | null = null;
  if (catalogEntry) {
    const { generateSystem } = await import("@/lib/game/generation");
    const generated = generateSystem(colony.system_id, catalogEntry);
    planetType = (generated.bodies[bodyIndex - 1]?.type ?? null) as BodyType | null;
  }

  // Health
  const isHarsh = planetType ? isHarshPlanetType(planetType) : false;
  const health = colonyHealthStatus(colony.upkeep_missed_periods);
  const upkeepDesc = upkeepDescription(colony.population_tier, isHarsh, upkeepRedFrac);

  // Build options
  const buildTypes = ["warehouse", "extractor", "habitat_module"] as const;
  const buildOptions = buildTypes.map((type) => {
    const currentTier = getStructureTier(structures, type);
    const targetTier = currentTier + 1;
    const atMax = currentTier >= BALANCE.structures.maxTier;
    const cost = atMax ? null : structureBuildCost(targetTier);
    const canAfford = cost
      ? stationIron >= cost.iron
      : false;
    return { type, currentTier, targetTier, cost, canAfford, atMax };
  });

  const statusColor: Record<Colony["status"], string> = {
    active: "text-emerald-400",
    abandoned: "text-amber-400",
    collapsed: "text-zinc-600",
  };

  const healthBadge: Record<string, { label: string; classes: string }> = {
    well_supplied: { label: "Supplied", classes: "bg-emerald-900/50 text-emerald-400 border-emerald-900/40" },
    struggling: { label: "Struggling", classes: "bg-amber-900/50 text-amber-400 border-amber-900/40" },
    neglected: { label: "Neglected", classes: "bg-red-900/50 text-red-400 border-red-900/40" },
  };
  const badge = healthBadge[health] ?? healthBadge.well_supplied;

  const systemName = systemDisplayName(colony.system_id);
  const bodyIndexStr = colony.body_id.slice(colony.body_id.lastIndexOf(":") + 1);

  let growthLabel: string | null = null;
  if (colony.status === "active") {
    if (!colony.next_growth_at) {
      growthLabel = "Max tier";
    } else if (colony.upkeep_missed_periods >= 1) {
      growthLabel = "Growth paused — send supplies";
    } else {
      const growthDate = new Date(colony.next_growth_at);
      growthLabel = `Grows ${growthDate > now ? growthDate.toLocaleDateString() : "soon"}`;
    }
  }

  const inventoryTotal = colonyInventory.reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold text-zinc-100">
              <Link
                href={`/game/system/${encodeURIComponent(colony.system_id)}`}
                className="hover:text-zinc-300 transition-colors"
              >
                {systemName}
              </Link>
              <span className="ml-2 text-sm text-zinc-600">· Body {bodyIndexStr}</span>
            </h1>
            {planetType && (
              <span className={`rounded-full px-2 py-0.5 text-xs border ${
                isHarsh
                  ? "bg-red-950/60 text-red-400 border-red-900/40"
                  : planetType === "lush" || planetType === "ocean" || planetType === "habitable"
                    ? "bg-emerald-950/60 text-emerald-500 border-emerald-900/40"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
              }`}>
                {bodyTypeLabel(planetType)}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-xs border ${badge.classes}`}>
              {badge.label}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-zinc-500">
            Tier {colony.population_tier}{" "}
            <span className={`font-medium ${statusColor[colony.status]}`}>
              {colony.status}
            </span>
            {growthLabel && (
              <span className={`ml-2 text-xs ${colony.upkeep_missed_periods >= 1 ? "text-amber-500" : "text-zinc-600"}`}>
                · {growthLabel}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/game/map"
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-colors"
          >
            Map →
          </Link>
          <Link
            href="/game/command"
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-colors"
          >
            ← Command
          </Link>
        </div>
      </div>

      {/* Health warning */}
      {colony.status === "active" && health !== "well_supplied" && (
        <div className={`rounded-lg border px-4 py-3 ${
          health === "neglected"
            ? "border-red-900 bg-red-950/30"
            : "border-amber-900 bg-amber-950/30"
        }`}>
          <p className={`text-sm font-medium ${health === "neglected" ? "text-red-400" : "text-amber-400"}`}>
            {health === "neglected"
              ? `Neglected (${colony.upkeep_missed_periods} missed periods) — dispatch a ship with ${isHarsh ? "food + iron" : "food"} to station immediately`
              : `Low ${isHarsh ? "food/iron" : "food"} supply — yields reduced`}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{upkeepDesc}</p>
        </div>
      )}

      {/* Tax + Extraction actions */}
      {colony.status === "active" && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Yield
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
              <p className="text-xs text-zinc-600 uppercase tracking-wider">Tax accrued</p>
              {accrued > 0 ? (
                <>
                  <p className="mt-1 font-mono text-lg font-semibold text-amber-300">
                    {accrued} ¢
                  </p>
                  <div className="mt-2">
                    <CollectButton colonyId={colony.id} accrued={accrued} />
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-zinc-500">
                  {BALANCE.colony.taxPerHourByTier[colony.population_tier]} ¢/hr
                </p>
              )}
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
              <p className="text-xs text-zinc-600 uppercase tracking-wider">Extraction</p>
              {extractSummary ? (
                <>
                  <p className="mt-1 text-sm font-medium text-teal-300">{extractSummary} ready</p>
                  <div className="mt-2">
                    <ExtractButton colonyId={colony.id} summary={extractSummary} />
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-zinc-500">Accruing…</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Colony inventory */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Colony Inventory ({inventoryTotal} units)
        </h2>
        {colonyInventory.length > 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {colonyInventory.map((row) => (
                <div key={row.resource_type} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500 capitalize">
                    {row.resource_type.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono text-sm font-medium text-zinc-200">
                    {row.quantity.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-600">
              Dispatch a ship here to haul this cargo back to your station.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-center">
            <p className="text-sm text-zinc-600">Colony inventory is empty.</p>
          </div>
        )}
      </section>

      {/* Upkeep */}
      {colony.status === "active" && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Upkeep
          </h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <p className="text-sm text-zinc-400">{upkeepDesc}</p>
            {isHarsh && (
              <p className="mt-1 text-xs text-amber-500">
                Harsh world — requires both food and iron supply.
              </p>
            )}
            {habitatTier > 0 && upkeepRedFrac > 0 && (
              <p className="mt-1 text-xs text-emerald-500">
                Habitat Module T{habitatTier}: upkeep −{Math.round(upkeepRedFrac * 100)}%
              </p>
            )}
          </div>
        </section>
      )}

      {/* Structures */}
      {colony.status === "active" && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Structures
          </h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 space-y-4">
            {buildOptions.map(({ type, currentTier, targetTier, cost, canAfford, atMax }) => {
              const label =
                type === "warehouse" ? "Warehouse" :
                type === "extractor" ? "Extractor" :
                "Habitat Module";
              const description =
                type === "warehouse" ? "Increases colony storage capacity" :
                type === "extractor" ? "Boosts resource extraction rate" :
                "Reduces upkeep consumption";
              return (
                <div key={type} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-300">
                      {label}
                      {currentTier > 0 && (
                        <span className="ml-1.5 text-xs text-zinc-500">T{currentTier}</span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-600">{description}</p>
                  </div>
                  <div className="shrink-0">
                    {atMax ? (
                      <span className="text-xs text-zinc-600">Max (T{currentTier})</span>
                    ) : cost ? (
                      <BuildStructureButton
                        colonyId={colony.id}
                        structureType={type}
                        targetTier={targetTier}
                        ironCost={cost.iron}
                        carbonCost={cost.carbon}
                        canAfford={canAfford}
                        label={
                          currentTier === 0
                            ? `Build T1 (${cost.iron}⛏ ${cost.carbon} carbon)`
                            : `Upgrade T${targetTier} (${cost.iron}⛏ ${cost.carbon} carbon)`
                        }
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
            {stationIron > 0 && (
              <p className="text-xs text-zinc-700 border-t border-zinc-800 pt-2">
                Station iron: <span className="font-mono text-zinc-500">{stationIron.toLocaleString()}</span>
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
