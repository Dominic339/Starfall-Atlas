/**
 * Game dashboard — Command Centre.
 *
 * Phase 6 additions:
 *   - Core station summary (name, location, resource inventory)
 *   - Both starter ships displayed (Phase 5.5 introduced 2 ships)
 *   - Colony growth auto-resolved lazily on page load
 *   - Resource extraction accrual shown per colony with ExtractButton
 *   - Station inventory totals reflect extracted resources
 *
 * Fetch order:
 *   1. player (auth gate)
 *   2. ships, travel jobs, colonies, station (parallel after player)
 *   3. survey results for colony bodies, station inventory (parallel)
 *   4. Growth resolution (DB writes for any due colonies)
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult, maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { systemDisplayName, getNearbySystems } from "@/lib/catalog";
import { calculateAccumulatedTax } from "@/lib/game/taxes";
import { applyGrowthResolution } from "@/lib/game/taxes";
import { calculateAccumulatedExtraction, formatExtractionSummary } from "@/lib/game/extraction";
import type { ExtractionAmount } from "@/lib/game/extraction";
import { BALANCE } from "@/lib/config/balance";
import type {
  Player,
  Ship,
  TravelJob,
  Colony,
  PlayerStation,
  ResourceInventoryRow,
  SurveyResult,
} from "@/lib/types/game";
import { CollectButton, ExtractButton, UnloadButton } from "./_components/ColonyActions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Command — Starfall Atlas",
};

export default async function GameDashboard() {
  const user = await getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // ── Step 1: player ────────────────────────────────────────────────────────
  const { data: player } = singleResult<Player>(
    await admin
      .from("players")
      .select("*")
      .eq("auth_id", user.id)
      .single(),
  );

  if (!player) redirect("/login");

  // ── Step 2: parallel fetches that only need player.id ─────────────────────
  const [shipsRes, jobsRes, coloniesRes, stationRes] = await Promise.all([
    admin.from("ships").select("*").eq("owner_id", player.id).order("created_at", { ascending: true }),
    admin
      .from("travel_jobs")
      .select("*")
      .eq("player_id", player.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1),
    admin
      .from("colonies")
      .select("*")
      .eq("owner_id", player.id)
      .order("created_at", { ascending: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from("player_stations")
      .select("*")
      .eq("owner_id", player.id)
      .maybeSingle(),
  ]);

  const shipList = (listResult<Ship>(shipsRes).data ?? []);
  const activeTravelJob = (listResult<TravelJob>(jobsRes).data ?? [])[0] ?? null;
  const rawColonies = (listResult<Colony>(coloniesRes).data ?? []);
  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;

  // ── Step 3: parallel fetches that need colony bodies / station.id ──────────
  const colonyBodyIds = rawColonies.map((c) => c.body_id);

  const shipIds = shipList.map((s) => s.id);

  const [surveyRes, invRes, cargoRes] = await Promise.all([
    colonyBodyIds.length > 0
      ? admin
          .from("survey_results")
          .select("body_id, resource_nodes")
          .in("body_id", colonyBodyIds)
      : Promise.resolve({ data: [] }),
    station
      ? admin
          .from("resource_inventory")
          .select("resource_type, quantity")
          .eq("location_type", "station")
          .eq("location_id", station.id)
          .order("resource_type", { ascending: true })
      : Promise.resolve({ data: [] }),
    shipIds.length > 0
      ? admin
          .from("resource_inventory")
          .select("location_id, resource_type, quantity")
          .eq("location_type", "ship")
          .in("location_id", shipIds)
      : Promise.resolve({ data: [] }),
  ]);

  const surveyByBodyId = new Map(
    ((surveyRes.data ?? []) as Pick<SurveyResult, "body_id" | "resource_nodes">[]).map(
      (s) => [s.body_id, s],
    ),
  );

  const stationInventory = (invRes.data ?? []) as Pick<
    ResourceInventoryRow,
    "resource_type" | "quantity"
  >[];

  // Build per-ship cargo map: shipId → sorted resource rows
  type CargoRow = Pick<ResourceInventoryRow, "resource_type" | "quantity"> & {
    location_id: string;
  };
  const cargoByShipId = new Map<string, { resource_type: string; quantity: number }[]>();
  for (const row of (cargoRes.data ?? []) as CargoRow[]) {
    const existing = cargoByShipId.get(row.location_id) ?? [];
    existing.push({ resource_type: row.resource_type, quantity: row.quantity });
    cargoByShipId.set(row.location_id, existing);
  }

  // ── Step 4: lazy growth resolution ──────────────────────────────────────
  const requestTime = new Date();
  const growthUpdates: { id: string; tier: number; next_growth_at: string | null }[] = [];

  const colonyList: Colony[] = rawColonies.map((colony) => {
    if (colony.status !== "active" || !colony.next_growth_at) return colony;
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

  // Persist growth updates in parallel (fire before render — user sees resolved state)
  if (growthUpdates.length > 0) {
    await Promise.all(
      growthUpdates.map(({ id, tier, next_growth_at }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (admin as any)
          .from("colonies")
          .update({ population_tier: tier, next_growth_at })
          .eq("id", id),
      ),
    );
  }

  const activeColonyCount = colonyList.filter((c) => c.status === "active").length;

  // ── Derived state ─────────────────────────────────────────────────────────
  const inTransitShipId = activeTravelJob?.ship_id ?? null;
  const currentSystemId =
    shipList.find((s) => s.current_system_id != null)?.current_system_id ?? null;

  const isInTransit =
    activeTravelJob !== null &&
    shipList.some((s) => !s.current_system_id && s.id === inTransitShipId);

  // ETA display for in-transit state
  let etaDisplay: string | null = null;
  if (isInTransit && activeTravelJob) {
    const arriveAt = new Date(activeTravelJob.arrive_at);
    const remainingMs = Math.max(0, arriveAt.getTime() - requestTime.getTime());
    const remainingMin = Math.ceil(remainingMs / 60_000);
    etaDisplay =
      remainingMin <= 0
        ? "Arrived — resolve travel"
        : remainingMin < 60
          ? `~${remainingMin} min remaining`
          : `~${(remainingMin / 60).toFixed(1)} hr remaining`;
  }

  // Nearby systems from a docked ship's location
  const dockedSystemId =
    shipList.find((s) => s.current_system_id != null && !isInTransit)
      ?.current_system_id ?? null;
  const nearbySystems = dockedSystemId
    ? getNearbySystems(dockedSystemId, BALANCE.lanes.baseRangeLy).slice(0, 4)
    : [];

  // ── Per-colony display data ───────────────────────────────────────────────
  const colonyDisplayData = colonyList.map((colony) => {
    const accrued =
      colony.status === "active"
        ? calculateAccumulatedTax(
            colony.last_tax_collected_at,
            colony.population_tier,
            requestTime,
          )
        : 0;

    const survey = surveyByBodyId.get(colony.body_id) ?? null;
    const accruedExtraction: ExtractionAmount[] =
      survey && colony.last_extract_at && colony.status === "active"
        ? calculateAccumulatedExtraction(
            survey.resource_nodes,
            colony.population_tier,
            colony.last_extract_at,
            requestTime,
          )
        : [];

    return { colony, accrued, accruedExtraction };
  });

  const totalAccrued = colonyDisplayData.reduce((s, d) => s + d.accrued, 0);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Command Centre</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Welcome back, {player.handle}.
        </p>
      </div>

      {/* Status grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Location */}
        <div className="rounded-lg border border-indigo-900 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Current location
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold text-indigo-300 truncate">
            {isInTransit
              ? systemDisplayName(activeTravelJob!.to_system_id)
              : currentSystemId
                ? systemDisplayName(currentSystemId)
                : "Unknown"}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {isInTransit && etaDisplay ? (
              etaDisplay
            ) : currentSystemId ? (
              <Link
                href={`/game/system/${encodeURIComponent(currentSystemId)}`}
                className="text-indigo-500 hover:text-indigo-400"
              >
                View system →
              </Link>
            ) : (
              "Position unknown"
            )}
          </p>
        </div>

        {/* Credits */}
        <div className="rounded-lg border border-amber-900 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Credits
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold text-amber-300">
            {player.credits.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {totalAccrued > 0
              ? `${totalAccrued} ¢ accrued — collect below`
              : activeColonyCount > 0
                ? "Taxes accruing — check colonies below"
                : "Found a colony to start earning"}
          </p>
        </div>

        {/* Colonies */}
        <div className="rounded-lg border border-emerald-900 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Active colonies
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold text-emerald-300">
            {activeColonyCount}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {player.colony_slots} slot
            {player.colony_slots !== 1 ? "s" : ""} available
          </p>
        </div>
      </div>

      {/* In-transit banner */}
      {isInTransit && activeTravelJob && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/70 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-300">
              <span className="text-zinc-500">In transit →</span>{" "}
              <Link
                href={`/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`}
                className="text-indigo-400 hover:text-indigo-300 font-medium"
              >
                {systemDisplayName(activeTravelJob.to_system_id)}
              </Link>
            </p>
            {etaDisplay && (
              <p className="text-xs text-zinc-500 mt-0.5">{etaDisplay}</p>
            )}
          </div>
          <Link
            href={`/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`}
            className="shrink-0 rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 transition-colors"
          >
            Go to system
          </Link>
        </div>
      )}

      {/* Core station */}
      {station && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Core Station
          </h2>
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  {station.name}
                </p>
                <p className="text-xs text-zinc-500">
                  {systemDisplayName(station.current_system_id)} ·{" "}
                  <span className="text-zinc-600">stationary (alpha)</span>
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                Hub
              </span>
            </div>

            {/* Station resource inventory */}
            {stationInventory.length > 0 ? (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <p className="mb-1.5 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Station inventory
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {stationInventory.map((row) => (
                    <span key={row.resource_type} className="text-xs text-zinc-400">
                      {row.resource_type}{" "}
                      <span className="font-mono text-zinc-300">
                        ×{row.quantity.toLocaleString()}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-zinc-600">
                Inventory empty — extract resources from colonies to fill it.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Ships */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Ships
        </h2>
        {shipList.length === 0 ? (
          <EmptyState message="No ships found. Try refreshing or signing out and back in." />
        ) : (
          <div className="space-y-2">
            {shipList.map((ship) => (
              <ShipRow
                key={ship.id}
                ship={ship}
                activeTravelJob={activeTravelJob}
                cargo={cargoByShipId.get(ship.id) ?? []}
                stationSystemId={station?.current_system_id ?? null}
              />
            ))}
          </div>
        )}
      </section>

      {/* Colonies */}
      {colonyList.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Colonies
          </h2>
          <div className="space-y-2">
            {colonyDisplayData.map(({ colony, accrued, accruedExtraction }) => (
              <ColonyRow
                key={colony.id}
                colony={colony}
                accrued={accrued}
                accruedExtraction={accruedExtraction}
              />
            ))}
          </div>
        </section>
      )}

      {/* Nearby systems */}
      {nearbySystems.length > 0 && dockedSystemId && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Nearby systems
          </h2>
          <div className="space-y-2">
            {nearbySystems.map((nearby) => (
              <Link
                key={nearby.id}
                href={`/game/system/${encodeURIComponent(nearby.id)}`}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 transition-colors hover:border-zinc-700"
              >
                <p className="text-sm font-medium text-zinc-200">{nearby.name}</p>
                <span className="font-mono text-xs text-zinc-500">
                  {nearby.distanceFromSource.toFixed(2)} ly
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Getting started */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">
          Getting started
        </h2>
        <ol className="space-y-1 text-sm text-zinc-500">
          <li>
            <span className="text-zinc-400">1.</span> Travel to a nearby system
            within {BALANCE.lanes.baseRangeLy} ly and discover it.
          </li>
          <li>
            <span className="text-zinc-400">2.</span> Survey a body to reveal
            its resources and colony suitability.
          </li>
          <li>
            <span className="text-zinc-400">3.</span> Found a colony on a
            habitable world — your first colony is free.
          </li>
          <li>
            <span className="text-zinc-400">4.</span> Collect taxes and extract
            resources from colonies into colony inventory.
          </li>
          <li>
            <span className="text-zinc-400">5.</span> Load ship cargo from a colony, then
            return to Sol to unload into your station.
          </li>
        </ol>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ShipRow({
  ship,
  activeTravelJob,
  cargo,
  stationSystemId,
}: {
  ship: Ship;
  activeTravelJob: TravelJob | null;
  cargo: { resource_type: string; quantity: number }[];
  stationSystemId: string | null;
}) {
  const isThisShipInTransit =
    !ship.current_system_id && activeTravelJob?.ship_id === ship.id;

  let locationDisplay: string;
  if (isThisShipInTransit && activeTravelJob) {
    locationDisplay = `En route → ${systemDisplayName(activeTravelJob.to_system_id)}`;
  } else if (ship.current_system_id) {
    locationDisplay = systemDisplayName(ship.current_system_id);
  } else {
    locationDisplay = "In transit";
  }

  const systemHref =
    isThisShipInTransit && activeTravelJob
      ? `/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`
      : ship.current_system_id
        ? `/game/system/${encodeURIComponent(ship.current_system_id)}`
        : null;

  const cargoUsed = cargo.reduce((s, r) => s + r.quantity, 0);
  const cargoSummary = cargo
    .map((r) => `${r.quantity} ${r.resource_type}`)
    .join(", ");
  const canUnload =
    !!ship.current_system_id &&
    stationSystemId !== null &&
    ship.current_system_id === stationSystemId &&
    cargo.length > 0;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-200">{ship.name}</p>
          <p className="text-xs text-zinc-500">
            {systemHref ? (
              <Link href={systemHref} className="hover:text-zinc-300 transition-colors">
                {locationDisplay}
              </Link>
            ) : (
              locationDisplay
            )}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-zinc-500">
            {ship.speed_ly_per_hr} ly/hr · {cargoUsed}/{ship.cargo_cap} cargo
          </p>
          <p className="text-xs text-zinc-700 capitalize">{ship.dispatch_mode}</p>
        </div>
      </div>

      {/* Cargo contents */}
      {cargo.length > 0 && (
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <p className="text-xs text-zinc-500 mb-1">
            Cargo:{" "}
            <span className="text-zinc-400">{cargoSummary}</span>
          </p>
          {canUnload && (
            <UnloadButton shipId={ship.id} summary={cargoSummary} />
          )}
        </div>
      )}
    </div>
  );
}

function ColonyRow({
  colony,
  accrued,
  accruedExtraction,
}: {
  colony: Colony;
  accrued: number;
  accruedExtraction: ExtractionAmount[];
}) {
  const systemName = systemDisplayName(colony.system_id);
  const bodyIndex = colony.body_id.slice(colony.body_id.lastIndexOf(":") + 1);

  const statusColor: Record<Colony["status"], string> = {
    active: "text-emerald-400",
    abandoned: "text-amber-400",
    collapsed: "text-zinc-600",
  };

  // Growth label
  let growthLabel: string | null = null;
  if (colony.status === "active") {
    if (!colony.next_growth_at) {
      growthLabel = "Max tier";
    } else {
      const growthDate = new Date(colony.next_growth_at);
      growthLabel = `grows ${growthDate > new Date() ? growthDate.toLocaleDateString() : "soon"}`;
    }
  }

  const extractSummary = formatExtractionSummary(accruedExtraction);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-200 truncate">
            <Link
              href={`/game/system/${encodeURIComponent(colony.system_id)}`}
              className="hover:text-zinc-100 transition-colors"
            >
              {systemName}
            </Link>
            <span className="ml-1.5 text-xs text-zinc-600">· Body {bodyIndex}</span>
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Tier {colony.population_tier}{" "}
            <span className={`font-medium ${statusColor[colony.status]}`}>
              {colony.status}
            </span>
            {growthLabel && (
              <span className="ml-2 text-zinc-600">· {growthLabel}</span>
            )}
          </p>
        </div>

        {/* Right-side actions */}
        <div className="shrink-0 text-right space-y-1.5">
          {/* Tax */}
          {colony.status === "active" && (
            <div>
              <p className="text-xs text-zinc-500">
                {accrued > 0 ? (
                  <span className="text-amber-300 font-medium">{accrued} ¢ accrued</span>
                ) : (
                  <span className="text-zinc-600">
                    {BALANCE.colony.taxPerHourByTier[colony.population_tier]} ¢/hr
                  </span>
                )}
              </p>
              {accrued > 0 && (
                <CollectButton colonyId={colony.id} accrued={accrued} />
              )}
            </div>
          )}

          {/* Extraction */}
          {colony.status === "active" && extractSummary && (
            <div>
              <p className="text-xs text-teal-300 font-medium">{extractSummary} ready</p>
              <ExtractButton colonyId={colony.id} summary={extractSummary} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center">
      <p className="text-sm text-zinc-600">{message}</p>
    </div>
  );
}

