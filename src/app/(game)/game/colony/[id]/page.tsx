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
import { colonyHealthStatus, upkeepDescription, extractionMultiplier } from "@/lib/game/colonyUpkeep";
import { isHarshPlanetType } from "@/lib/game/habitability";
import {
  getStructureTier,
  researchLevel,
  upkeepReductionFraction,
  effectiveStorageCap,
  structureBuildCost,
  extractionBonusMultiplier,
} from "@/lib/game/colonyStructures";
import { calculateAccumulatedExtraction, formatExtractionSummary, extractionRatePerNode } from "@/lib/game/extraction";
import { BALANCE } from "@/lib/config/balance";
import type {
  Player,
  Colony,
  Ship,
  Structure,
  PlayerStation,
  ResourceInventoryRow,
  PlayerResearch,
  SurveyResult,
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

export default async function ColonyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: colonyId } = await params;

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
      .eq("id", colonyId)
      .eq("owner_id", player.id)
      .maybeSingle(),
  );
  if (!colony) notFound();

  // Parallel data fetches
  const [invRes, structuresRes, stationRes, researchRes, surveyRes, shipsRes] = await Promise.all([
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
    admin
      .from("survey_results")
      .select("resource_nodes")
      .eq("body_id", colony.body_id)
      .maybeSingle(),
    admin
      .from("ships")
      .select("id, name, cargo_cap, dispatch_mode, auto_state, auto_target_colony_id")
      .eq("owner_id", player.id)
      .eq("current_system_id", colony.system_id),
  ]);

  const colonyInventory = (invRes.data ?? []) as Pick<ResourceInventoryRow, "resource_type" | "quantity">[];
  const structures = (structuresRes.data ?? []) as Structure[];
  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;
  const survey = (surveyRes.data as Pick<SurveyResult, "resource_nodes"> | null) ?? null;
  const shipsAtSystem = (shipsRes.data ?? []) as Pick<Ship, "id" | "name" | "cargo_cap" | "dispatch_mode" | "auto_state" | "auto_target_colony_id">[];
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

  // Structure tiers
  const sustainabilityResearchLvl = researchLevel(unlockedResearchIds, "sustainability");
  const storageResearchLvl = researchLevel(unlockedResearchIds, "storage");
  const extractionResearchLvl = researchLevel(unlockedResearchIds, "extraction");
  const warehouseTier = getStructureTier(structures, "warehouse");
  const habitatTier = getStructureTier(structures, "habitat_module");
  const extractorTier = getStructureTier(structures, "extractor");
  const upkeepRedFrac = upkeepReductionFraction(habitatTier, sustainabilityResearchLvl);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _storageCap = effectiveStorageCap(colony.storage_cap, warehouseTier, storageResearchLvl);

  // Extraction estimate
  const extBonusMult = extractionBonusMultiplier(extractorTier, extractionResearchLvl);
  const healthMult = extractionMultiplier(colony.upkeep_missed_periods);
  const resourceNodes = survey?.resource_nodes ?? [];
  // Fall back to colony founding time so extraction accrues from day 1
  const lastExtractAt = colony.last_extract_at ?? colony.created_at;
  const rawAccruedExtraction = calculateAccumulatedExtraction(
    resourceNodes,
    colony.population_tier,
    lastExtractAt,
    now,
    extBonusMult,
  );
  const accruedExtraction = rawAccruedExtraction
    .map((item) => ({ ...item, quantity: Math.floor(item.quantity * healthMult) }))
    .filter((item) => item.quantity > 0);
  const extractSummary = formatExtractionSummary(accruedExtraction);

  // Extraction rate / elapsed display helpers
  const basicNodeCount = resourceNodes.filter((n) => !n.is_rare).length;
  const totalRatePerHr = Math.floor(
    extractionRatePerNode(colony.population_tier) * basicNodeCount * extBonusMult * healthMult,
  );
  const elapsedHours = (now.getTime() - new Date(lastExtractAt).getTime()) / (1000 * 60 * 60);
  const isCapped = elapsedHours >= BALANCE.extraction.accumulationCapHours;

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
    <div className="mx-auto max-w-5xl p-6 space-y-6">
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

      {/* Tax + Extraction yield */}
      {colony.status === "active" && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Yield
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Tax */}
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

            {/* Extraction */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
              <p className="text-xs text-zinc-600 uppercase tracking-wider">Resources accrued</p>
              {resourceNodes.length === 0 ? (
                <p className="mt-1 text-sm text-zinc-600">No survey data — conduct a survey to unlock extraction.</p>
              ) : extractSummary ? (
                <>
                  <p className="mt-1 text-sm font-medium text-teal-300">{extractSummary}</p>
                  {isCapped && (
                    <p className="mt-0.5 text-xs text-amber-500">
                      Accumulation capped — extract or dispatch a ship to collect.
                    </p>
                  )}
                  <div className="mt-2">
                    <ExtractButton colonyId={colony.id} summary={extractSummary} />
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-zinc-500">
                  Accumulating…{" "}
                  {basicNodeCount > 0 && totalRatePerHr > 0 && (
                    <span className="text-xs text-zinc-600">
                      ({totalRatePerHr} u/hr across {basicNodeCount} node{basicNodeCount !== 1 ? "s" : ""})
                    </span>
                  )}
                </p>
              )}
              {/* Rate line — always show when we have nodes */}
              {basicNodeCount > 0 && (
                <p className="mt-2 text-xs text-zinc-600 border-t border-zinc-800/60 pt-2">
                  Rate: <span className="text-zinc-400">{totalRatePerHr} u/hr</span>
                  {" · "}
                  {elapsedHours < 1
                    ? `${Math.round(elapsedHours * 60)}m since last extract`
                    : `${elapsedHours.toFixed(1)}h since last extract`}
                  {" · "}cap at {BALANCE.extraction.accumulationCapHours}h
                  {extractorTier > 0 && (
                    <span className="ml-1 text-teal-700"> · Extractor T{extractorTier}</span>
                  )}
                </p>
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
            <p className="mt-3 text-xs text-zinc-600 border-t border-zinc-800 pt-2">
              Dispatch a ship to this system from the{" "}
              <Link href="/game/map" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                map
              </Link>{" "}
              or your{" "}
              <Link href="/game/station" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                station
              </Link>{" "}
              to haul this cargo.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-center">
            <p className="text-sm text-zinc-600">
              Colony inventory is empty.
            </p>
            <p className="mt-1 text-xs text-zinc-700">
              Use <strong className="text-zinc-600">Extract</strong> above to push accrued resources here,
              then dispatch a ship to haul them to your station.
            </p>
          </div>
        )}
      </section>

      {/* Ships at this system */}
      {shipsAtSystem.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Ships Here ({shipsAtSystem.length})
          </h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 space-y-2">
            {shipsAtSystem.map((ship) => {
              const isAutoTargetingThis = ship.auto_target_colony_id === colony.id;
              const modeLabel =
                ship.dispatch_mode === "manual"
                  ? "Manual"
                  : ship.dispatch_mode === "auto_collect_nearest"
                    ? "Auto: Nearest"
                    : "Auto: Highest yield";
              const stateLabel =
                ship.auto_state === "traveling_to_colony"
                  ? "En route here"
                  : ship.auto_state === "traveling_to_station"
                    ? "Returning to station"
                    : ship.dispatch_mode !== "manual"
                      ? "Idle (auto)"
                      : "Docked";
              return (
                <div key={ship.id} className="flex items-center justify-between gap-4">
                  <div>
                    <span className="text-sm font-medium text-zinc-300">{ship.name}</span>
                    {isAutoTargetingThis && (
                      <span className="ml-2 rounded-full px-1.5 py-0.5 text-xs bg-indigo-900/50 text-indigo-400 border border-indigo-900/40">
                        assigned
                      </span>
                    )}
                    <p className="text-xs text-zinc-600">
                      {stateLabel} · {modeLabel} · {ship.cargo_cap.toLocaleString()} cargo
                    </p>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-zinc-700 border-t border-zinc-800 pt-2">
              Change ship modes from your{" "}
              <Link href="/game/station" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                station
              </Link>.
            </p>
          </div>
        </section>
      )}

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
