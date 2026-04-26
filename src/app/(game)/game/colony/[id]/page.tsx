/**
 * /game/colony/[id] — Dedicated Colony page.
 *
 * Shows a colony's current state: tier, health, stockpile,
 * structures, growth timeline, and logistics context.
 *
 * The colony is a passive production node in the logistics chain:
 *   - Resources accumulate automatically via engine tick (no manual extract required)
 *   - Tax accrues over time and can be collected
 *   - Ships haul the colony stockpile back to the station automatically or on demand
 *   - Colony requires food (and iron on harsh worlds) shipped from the station
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
import { CollectButton, ExtractButton, RevokePermitButton, EuxBuyButton, ReactivateButton } from "../../_components/ColonyActions";
import { BuildStructureButton } from "../../_components/ColonyStructures";
import { runEngineTick } from "@/lib/game/engineTick";
import { getBalanceWithOverrides } from "@/lib/config/balanceOverrides";
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
  const balance = await getBalanceWithOverrides(admin);

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // Materialise colony inventory and resolve upkeep so this page always shows
  // current state even when navigated directly (without visiting map/command).
  await runEngineTick(admin, player.id, new Date(), balance);

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
  const euxSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [invRes, structuresRes, stationRes, researchRes, surveyRes, shipsRes, stewardshipRes, euxUsageRes] = await Promise.all([
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
      .select("id, name, cargo_cap, dispatch_mode, auto_state, auto_target_colony_id, pinned_colony_id")
      .eq("owner_id", player.id)
      .eq("current_system_id", colony.system_id),
    // Body stewardship for this body
    admin
      .from("body_stewardship")
      .select("steward_id, default_tax_rate_pct")
      .eq("body_id", colony.body_id)
      .maybeSingle(),

    // EUX purchases in last 24h (for daily limit display)
    admin
      .from("universal_exchange_purchases")
      .select("quantity")
      .eq("player_id", player.id)
      .gte("purchased_at", euxSince),
  ]);

  const colonyInventory = (invRes.data ?? []) as Pick<ResourceInventoryRow, "resource_type" | "quantity">[];
  const structures = (structuresRes.data ?? []) as Structure[];
  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;
  const survey = (surveyRes.data as Pick<SurveyResult, "resource_nodes"> | null) ?? null;
  const shipsAtSystem = (shipsRes.data ?? []) as Pick<Ship, "id" | "name" | "cargo_cap" | "dispatch_mode" | "auto_state" | "auto_target_colony_id" | "pinned_colony_id">[];
  const unlockedResearchIds = new Set(
    (listResult<Pick<PlayerResearch, "research_id">>(researchRes).data ?? []).map(
      (r) => r.research_id,
    ),
  );

  // Stewardship + permit resolution
  type StewardshipRow = { steward_id: string; default_tax_rate_pct: number };
  type PermitRow = { id: string; steward_id: string; grantee_id: string; tax_rate_pct: number; status: string };

  const stewardship = (stewardshipRes.data as StewardshipRow | null) ?? null;
  const isPlayerSteward = stewardship?.steward_id === player.id;

  let stewardHandle: string | null = null;
  let activePermits: (PermitRow & { granteeHandle: string })[] = [];
  let myPermit: PermitRow | null = null;

  if (stewardship) {
    if (isPlayerSteward) {
      // Steward: fetch all active permits on this body so they can be shown/revoked
      const { data: permitRows } = await admin
        .from("colony_permits")
        .select("id, steward_id, grantee_id, tax_rate_pct, status")
        .eq("body_id", colony.body_id)
        .eq("status", "active");

      const granteeIds = (permitRows ?? []).map((p: PermitRow) => p.grantee_id);
      let granteeHandleMap = new Map<string, string>();
      if (granteeIds.length > 0) {
        const { data: handleRows } = await admin
          .from("players")
          .select("id, handle")
          .in("id", granteeIds);
        granteeHandleMap = new Map(
          (handleRows ?? []).map((h: { id: string; handle: string }) => [h.id, h.handle]),
        );
      }
      activePermits = (permitRows ?? []).map((p: PermitRow) => ({
        ...p,
        granteeHandle: granteeHandleMap.get(p.grantee_id) ?? "Unknown",
      }));
    } else {
      // Grantee: fetch steward handle + own permit
      const [{ data: stewardPlayer }, { data: permitRow }] = await Promise.all([
        admin.from("players").select("handle").eq("id", stewardship.steward_id).maybeSingle(),
        admin
          .from("colony_permits")
          .select("id, steward_id, grantee_id, tax_rate_pct, status")
          .eq("body_id", colony.body_id)
          .eq("grantee_id", player.id)
          .maybeSingle(),
      ]);
      stewardHandle = (stewardPlayer as { handle: string } | null)?.handle ?? null;
      myPermit = (permitRow as PermitRow | null) ?? null;
    }
  }

  // EUX daily usage
  const euxDailyUsed = (euxUsageRes.data ?? []).reduce(
    (sum: number, r: { quantity: number }) => sum + r.quantity,
    0,
  );
  const euxOptions = (["iron", "carbon", "ice"] as const).map((rt) => {
    const floor = BALANCE.emergencyExchange.floorPricePerUnit[rt] ?? 5;
    const pricePerUnit = Math.ceil(
      floor * BALANCE.emergencyExchange.markupMultiplier *
      (1 + BALANCE.emergencyExchange.transactionFeePercent / 100),
    );
    return { resourceType: rt, pricePerUnit };
  });

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
  const storageCap = effectiveStorageCap(colony.storage_cap, warehouseTier, storageResearchLvl);

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
          {/* Colony health bar */}
          {colony.status === "active" && (
            <div className="mt-2 flex items-center gap-2 max-w-xs">
              <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    health === "neglected"  ? "bg-red-600"
                    : health === "struggling" ? "bg-amber-500"
                    : "bg-emerald-600"
                  }`}
                  style={{ width: `${Math.round(healthMult * 100)}%` }}
                />
              </div>
              <span className={`text-xs font-mono shrink-0 ${
                health === "neglected" ? "text-red-500" : health === "struggling" ? "text-amber-500" : "text-emerald-600"
              }`}>
                {Math.round(healthMult * 100)}%
              </span>
            </div>
          )}
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

      {/* ── Abandoned banner ──────────────────────────────────────────────── */}
      {colony.status === "abandoned" && (() => {
        const windowMs    = BALANCE.inactivity.resolutionWindowDays * 24 * 3_600_000;
        const abandonedAt = colony.abandoned_at ? new Date(colony.abandoned_at) : now;
        const collapseAt  = new Date(abandonedAt.getTime() + windowMs);
        const msLeft      = collapseAt.getTime() - now.getTime();
        const daysLeft    = Math.max(0, Math.floor(msLeft / 86_400_000));
        const hoursLeft   = Math.max(0, Math.floor((msLeft % 86_400_000) / 3_600_000));
        const withinWindow = msLeft > 0;
        return (
          <div className="rounded-lg border border-amber-800 bg-amber-950/30 px-4 py-3 space-y-2">
            <p className="text-sm font-medium text-amber-400">
              Colony Abandoned
            </p>
            {withinWindow ? (
              <>
                <p className="text-xs text-zinc-400">
                  This colony was abandoned due to inactivity. You have{" "}
                  <span className="font-semibold text-amber-300">
                    {daysLeft}d {hoursLeft}h
                  </span>{" "}
                  left to reactivate before it collapses and the body reopens for others.
                </p>
                <ReactivateButton colonyId={colony.id} />
              </>
            ) : (
              <p className="text-xs text-zinc-500">
                The reactivation window has expired. This colony will collapse on the next engine tick.
              </p>
            )}
          </div>
        );
      })()}

      {/* ── Collapsed banner ──────────────────────────────────────────────── */}
      {colony.status === "collapsed" && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3">
          <p className="text-sm font-medium text-zinc-500">Colony Collapsed</p>
          <p className="mt-1 text-xs text-zinc-600">
            This colony collapsed after the reactivation window expired. The body is now available for re-colonization.
            Any structures left behind exist as ruins and may be salvaged by the new colony owner.
          </p>
        </div>
      )}

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

      {/* ── Stockpile (primary focus) ──────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Stockpile
          </h2>
          <span className="text-xs text-zinc-600">
            {inventoryTotal > 0 ? `${inventoryTotal.toLocaleString()} units ready to haul` : "empty"}
          </span>
        </div>
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
              Haul this cargo: dispatch a ship from the{" "}
              <Link href="/game/map" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                map
              </Link>{" "}
              or set a ship to{" "}
              <Link href="/game/station" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                auto-collect
              </Link>.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-center">
            <p className="text-sm text-zinc-600">Stockpile is empty.</p>
            <p className="mt-1 text-xs text-zinc-700">
              Resources accumulate automatically.{" "}
              {basicNodeCount > 0 && totalRatePerHr > 0 && (
                <span>At {totalRatePerHr} u/hr the stockpile will build up over time.</span>
              )}
            </p>
          </div>
        )}
      </section>

      {/* ── Output — production rate + tax ─────────────────────────────────── */}
      {colony.status === "active" && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Output
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

            {/* Production rate */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
              <p className="text-xs text-zinc-600 uppercase tracking-wider">Resource production</p>
              {resourceNodes.length === 0 ? (
                <p className="mt-1 text-sm text-zinc-600">
                  No survey — conduct a survey to unlock extraction.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm font-medium text-teal-300">
                    {totalRatePerHr > 0
                      ? `${totalRatePerHr} u/hr`
                      : <span className="text-zinc-500">Paused (supply issue)</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {basicNodeCount} node{basicNodeCount !== 1 ? "s" : ""}
                    {extractorTier > 0 && ` · Extractor T${extractorTier}`}
                    {extractionResearchLvl > 0 && (
                      <span className="ml-1 text-teal-600">· Research +{extractionResearchLvl * 10}%</span>
                    )}
                    {healthMult < 1 && (
                      <span className="ml-1 text-amber-600">· yield reduced</span>
                    )}
                  </p>
                  {isCapped && (
                    <p className="mt-1.5 text-xs text-amber-500">
                      Accumulation cap reached — send a ship to haul.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-zinc-700 border-t border-zinc-800/60 pt-2">
                    Flows into stockpile automatically · cap at {BALANCE.extraction.accumulationCapHours}h
                  </p>
                </>
              )}
            </div>

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
          </div>
        </section>
      )}

      {/* ── Ships ──────────────────────────────────────────────────────────── */}
      {shipsAtSystem.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Ships in System ({shipsAtSystem.length})
          </h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 space-y-2">
            {shipsAtSystem.map((ship) => {
              const isAssigned = ship.pinned_colony_id === colony.id;
              const isAuto = ship.dispatch_mode !== "manual";
              const stateLabel =
                ship.auto_state === "traveling_to_colony"
                  ? "En route here"
                  : ship.auto_state === "traveling_to_station"
                    ? "Returning to station with cargo"
                    : isAuto
                      ? "Idle — waiting to haul"
                      : "Docked (manual)";
              return (
                <div key={ship.id} className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-300">{ship.name}</span>
                      {isAssigned && (
                        <span className="rounded-full px-1.5 py-0.5 text-xs bg-indigo-900/50 text-indigo-400 border border-indigo-900/40">
                          assigned here
                        </span>
                      )}
                      {isAuto && !isAssigned && (
                        <span className="rounded-full px-1.5 py-0.5 text-xs bg-teal-900/40 text-teal-600 border border-teal-900/30">
                          auto
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-600">
                      {stateLabel} · {ship.cargo_cap.toLocaleString()} cargo cap
                    </p>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-zinc-700 border-t border-zinc-800 pt-2">
              Assign ships to auto-collect from this colony via your{" "}
              <Link href="/game/station" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                station
              </Link>{" "}
              or dispatch manually from the{" "}
              <Link href="/game/map" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                map
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

      {/* Emergency Universal Exchange */}
      {colony.status === "active" && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Emergency Supply
          </h2>
          <div className={`rounded-lg border px-4 py-3 ${
            health !== "well_supplied"
              ? "border-orange-900/50 bg-orange-950/20"
              : "border-zinc-800 bg-zinc-900/50"
          }`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-zinc-500">
                  Emergency Universal Exchange — instant delivery at {BALANCE.emergencyExchange.markupMultiplier}× markup
                  {health !== "well_supplied" && (
                    <span className="ml-1 text-orange-500">· colony needs supplies</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-zinc-700">
                  {BALANCE.emergencyExchange.dailyLimitUnits} units/day · {BALANCE.emergencyExchange.transactionFeePercent}% fee · iron, carbon, ice only
                </p>
              </div>
            </div>
            <div className="mt-3">
              <EuxBuyButton
                colonyId={colony.id}
                options={euxOptions}
                dailyUsed={euxDailyUsed}
                dailyLimit={BALANCE.emergencyExchange.dailyLimitUnits}
                playerCredits={player.credits}
              />
            </div>
          </div>
        </section>
      )}

      {/* Stewardship / Permit */}
      {stewardship && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Stewardship
          </h2>
          {isPlayerSteward ? (
            <div className="rounded-lg border border-yellow-900/40 bg-yellow-950/20 px-4 py-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-yellow-400">You are the steward</p>
                <span className="text-xs text-zinc-600">
                  Default tax: <span className="font-mono text-zinc-400">{stewardship.default_tax_rate_pct}%</span>
                </span>
              </div>
              {activePermits.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-600 uppercase tracking-wider">Active permits</p>
                  {activePermits.map((permit) => (
                    <div key={permit.id} className="flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                      <div>
                        <span className="text-sm text-zinc-300">{permit.granteeHandle}</span>
                        <span className="ml-2 text-xs text-amber-600/80">{permit.tax_rate_pct}% tax</span>
                      </div>
                      <RevokePermitButton permitId={permit.id} granteeHandle={permit.granteeHandle} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">
                  No active permits — other players will be granted a permit automatically when they found here.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Steward:</span>
                <span className="text-sm text-yellow-500">{stewardHandle ?? "Unknown"}</span>
              </div>
              {myPermit ? (
                <p className="text-xs text-zinc-500">
                  Permit{" "}
                  <span className={myPermit.status === "active" ? "text-emerald-500" : "text-red-500"}>
                    {myPermit.status}
                  </span>
                  {myPermit.status === "active" && myPermit.tax_rate_pct > 0 && (
                    <span className="ml-1 text-amber-600">· {myPermit.tax_rate_pct}% extraction deducted to steward</span>
                  )}
                  {myPermit.status === "active" && myPermit.tax_rate_pct === 0 && (
                    <span className="ml-1 text-zinc-600">· no extraction tax</span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-zinc-600">No permit record found.</p>
              )}
            </div>
          )}
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
                type === "warehouse"
                  ? `Increases colony storage capacity${warehouseTier > 0 || storageResearchLvl > 0 ? ` (cap: ${storageCap}u)` : ""}`
                  : type === "extractor" ? "Boosts resource extraction rate" :
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
                            ? `Build T1 (${cost.iron}⛏${cost.carbon > 0 ? ` ${cost.carbon} carbon` : ""})`
                            : `Upgrade T${targetTier} (${cost.iron}⛏${cost.carbon > 0 ? ` ${cost.carbon} carbon` : ""})`
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

      {/* ── Manual override (dev / fallback) ───────────────────────────────── */}
      {colony.status === "active" && resourceNodes.length > 0 && extractSummary && (
        <details className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-4 py-2 text-xs">
          <summary className="cursor-pointer text-zinc-700 hover:text-zinc-500 transition-colors select-none">
            Manual extraction override
          </summary>
          <div className="mt-3 space-y-2 pb-1">
            <p className="text-zinc-600">
              Resources accumulate automatically on page load. Use this only if you need to force-sync mid-cycle.
            </p>
            <ExtractButton colonyId={colony.id} summary={extractSummary} />
          </div>
        </details>
      )}
    </div>
  );
}
