/**
 * /game/station — Logistics Hub.
 *
 * The station is the player's central logistics hub:
 *   - Station inventory: all resources held here
 *   - Credits balance
 *   - Docked ships: unload cargo or dispatch to a target system
 *   - Ships away: ships at colonies or in transit
 *   - Refine: process raw resources
 *   - Colonies list with stockpile totals and quick links
 *
 * From here the player can dispatch any docked ship to any system within
 * travel range without visiting the galaxy map.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getNearbySystems, systemDisplayName } from "@/lib/catalog";
import { BALANCE } from "@/lib/config/balance";
import type { Player, Ship, PlayerStation, ResourceInventoryRow, Colony } from "@/lib/types/game";
import { UnloadButton } from "../_components/ColonyActions";
import { RefineForm } from "../_components/RefineControls";
import { ShipDispatchForm } from "../_components/ShipDispatchForm";
import { ShipModeButton } from "../_components/ShipModeButton";
import { ShipAssignColonyControl } from "../_components/ShipAssignColonyControl";
import { autoStateLabel, dispatchModeLabel, formatEtaMs } from "@/lib/game/shipAutomation";
import { runTravelResolution } from "@/lib/game/travelResolution";
import { runEngineTick } from "@/lib/game/engineTick";
import { getBalanceWithOverrides } from "@/lib/config/balanceOverrides";
import { taxRateForTier } from "@/lib/game/taxes";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Station — Starfall Atlas",
};

// ---------------------------------------------------------------------------
// Section heading helper (server-side, inline component)
// ---------------------------------------------------------------------------

function SectionHeading({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className="inline-block h-3.5 w-0.5 rounded-full bg-indigo-700" />
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
          {title}
        </h2>
      </div>
      {meta && <div className="text-xs">{meta}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function StationPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const balance = await getBalanceWithOverrides(admin);

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // Resolve colony growth, upkeep, biomass→food conversion, and passive
  // extraction so colony inventories are current before auto-haul reads them.
  const requestTime = new Date();
  await runEngineTick(admin, player.id, requestTime, balance);

  // Advance auto-ship state machines so ships that arrived since the last
  // map/command visit are properly landed and ready to act.
  await runTravelResolution(admin, player.id, requestTime);

  // Parallel fetches
  const [stationRes, shipsRes, coloniesRes] = await Promise.all([
    admin.from("player_stations").select("*").eq("owner_id", player.id).maybeSingle(),
    admin
      .from("ships")
      .select("id, name, current_system_id, destination_system_id, speed_ly_per_hr, cargo_cap, dispatch_mode, auto_state, auto_target_colony_id, pinned_colony_id")
      .eq("owner_id", player.id)
      .order("created_at", { ascending: true }),
    admin
      .from("colonies")
      .select("id, system_id, body_id, status, population_tier")
      .eq("owner_id", player.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
  ]);

  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;
  const ships = listResult<Ship>(shipsRes).data ?? [];

  type ColonyRow = Pick<Colony, "id" | "system_id" | "body_id" | "status" | "population_tier">;
  const colonies = (listResult<ColonyRow>(coloniesRes).data ?? []);

  // Total credit income rate across all active colonies (for station display)
  const creditsPerHour = colonies.reduce(
    (sum, c) => sum + taxRateForTier(c.population_tier),
    0,
  );

  // Resolve auto_target_colony_id → system display name for away ships
  const colonySystemNameById = new Map(
    colonies.map((c) => [c.id, systemDisplayName(c.system_id)]),
  );

  // Pre-formatted colony options for the assignment control
  const colonySelectOptions = colonies.map((c) => {
    const bodyIdx = c.body_id.slice(c.body_id.lastIndexOf(":") + 1);
    return {
      id: c.id,
      label: `${systemDisplayName(c.system_id)} · Body ${bodyIdx} (T${c.population_tier})`,
    };
  });

  if (!station) {
    return (
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/game/command" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
            ← Command
          </Link>
          <span className="text-zinc-800 text-xs">/</span>
          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Station</span>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-8 text-center">
          <p className="text-sm text-zinc-500 mb-2">No station found.</p>
          <p className="text-xs text-zinc-700">
            Visit the{" "}
            <Link href="/game/map" className="text-indigo-400 hover:text-indigo-300">
              Galaxy Map
            </Link>{" "}
            to trigger bootstrap.
          </p>
        </div>
      </div>
    );
  }

  // Bucket ships
  const dockedShips = ships.filter((s) => s.current_system_id === station.current_system_id);
  const travelingShips = ships.filter((s) => s.current_system_id === null);
  const awayShips = ships.filter(
    (s) =>
      s.current_system_id !== null &&
      s.current_system_id !== station.current_system_id,
  );
  const dockedShipIds = dockedShips.map((s) => s.id);
  const activeColonyIds = colonies.map((c) => c.id);

  // Build map: colonyId → names of ships PINNED to it (player-set intent via pinned_colony_id)
  const pinnedShipNamesByColonyId = new Map<string, string[]>();
  for (const ship of ships) {
    if (ship.pinned_colony_id) {
      const list = pinnedShipNamesByColonyId.get(ship.pinned_colony_id) ?? [];
      list.push(ship.name);
      pinnedShipNamesByColonyId.set(ship.pinned_colony_id, list);
    }
  }

  // Coverage stats — colonies with at least one pinned ship vs. without
  const servedCount = colonies.filter((c) => pinnedShipNamesByColonyId.has(c.id)).length;
  const unservedCount = colonies.length - servedCount;

  const [invRes, cargoRes, colonyInvRes, travelJobsRes] = await Promise.all([
    admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .order("resource_type", { ascending: true }),
    dockedShipIds.length > 0
      ? admin
          .from("resource_inventory")
          .select("location_id, resource_type, quantity")
          .eq("location_type", "ship")
          .in("location_id", dockedShipIds)
      : Promise.resolve({ data: [] }),
    activeColonyIds.length > 0
      ? admin
          .from("resource_inventory")
          .select("location_id, quantity")
          .eq("location_type", "colony")
          .in("location_id", activeColonyIds)
      : Promise.resolve({ data: [] }),
    // Active travel jobs — for ETA display on traveling ships
    admin
      .from("travel_jobs")
      .select("ship_id, arrive_at")
      .eq("player_id", player.id)
      .eq("status", "pending"),
  ]);

  const stationInventory = (invRes.data ?? []) as Pick<
    ResourceInventoryRow,
    "resource_type" | "quantity"
  >[];

  type CargoRow = Pick<ResourceInventoryRow, "resource_type" | "quantity"> & {
    location_id: string;
  };
  const cargoByShipId = new Map<string, { resource_type: string; quantity: number }[]>();
  for (const row of (cargoRes.data ?? []) as CargoRow[]) {
    const list = cargoByShipId.get(row.location_id) ?? [];
    list.push({ resource_type: row.resource_type, quantity: row.quantity });
    cargoByShipId.set(row.location_id, list);
  }

  type ColonyInvRow = { location_id: string; quantity: number };
  const colonyStockpileTotals = new Map<string, number>();
  for (const row of (colonyInvRes.data ?? []) as ColonyInvRow[]) {
    colonyStockpileTotals.set(
      row.location_id,
      (colonyStockpileTotals.get(row.location_id) ?? 0) + row.quantity,
    );
  }

  // shipId → arrive_at ISO string for active travel jobs
  type TravelJobRow = { ship_id: string; arrive_at: string };
  const arriveAtByShipId = new Map<string, string>(
    ((travelJobsRes.data ?? []) as TravelJobRow[]).map((tj) => [tj.ship_id, tj.arrive_at]),
  );

  const totalIron = stationInventory.find((r) => r.resource_type === "iron")?.quantity ?? 0;
  const totalFood = stationInventory.find((r) => r.resource_type === "food")?.quantity ?? 0;
  const totalStationUnits = stationInventory.reduce((s, r) => s + r.quantity, 0);

  // Systems within travel range of the station (for dispatch controls)
  const colonySystemIds = new Set(colonies.map((c) => c.system_id as string));
  const nearbySystems = getNearbySystems(station.current_system_id, BALANCE.lanes.baseRangeLy).map(
    (s) => ({
      id: s.id,
      name: colonySystemIds.has(s.id) ? `${s.name} ★` : s.name,
    }),
  );

  const allShipsAway = awayShips.length + travelingShips.length;

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">

      {/* ── Station Identity Panel ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-700/50 bg-gradient-to-br from-zinc-800/50 via-zinc-900 to-zinc-900 px-6 py-5 shadow-lg shadow-black/20">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-xl font-bold text-zinc-100 truncate">{station.name}</h1>
              <span className="rounded border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-0.5 text-xs font-semibold text-zinc-500 tracking-wide shrink-0">
                Logistics Hub
              </span>
            </div>
            <div className="text-sm">
              <Link
                href={`/game/system/${encodeURIComponent(station.current_system_id)}`}
                className="text-amber-400 hover:text-amber-300 transition-colors font-medium"
              >
                {systemDisplayName(station.current_system_id)}
              </Link>
            </div>
            {/* Fleet + colony status row */}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-semibold text-zinc-300 tabular-nums">{dockedShips.length}</span>
                <span className="text-zinc-600">{dockedShips.length === 1 ? "ship docked" : "ships docked"}</span>
              </span>
              {allShipsAway > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                  <span className="font-semibold text-zinc-300 tabular-nums">{allShipsAway}</span>
                  <span className="text-zinc-600">{allShipsAway === 1 ? "ship away" : "ships away"}</span>
                </span>
              )}
              {colonies.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-600 shrink-0" />
                  <span className="font-semibold text-zinc-300 tabular-nums">{colonies.length}</span>
                  <span className="text-zinc-600">{colonies.length === 1 ? "colony" : "colonies"}</span>
                </span>
              )}
            </div>
          </div>
          <Link
            href="/game/map"
            className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-800/70 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-700/80 hover:text-zinc-200 transition-colors"
          >
            Galaxy Map →
          </Link>
        </div>
      </div>

      {/* ── Summary tiles ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Credits */}
        <div className="rounded-xl border border-amber-900/50 bg-zinc-900/80 px-4 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Credits</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-amber-300 tabular-nums">
            {player.credits.toLocaleString("en-US")}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            {creditsPerHour > 0
              ? <span className="text-amber-700">+{creditsPerHour.toLocaleString("en-US")} ¢/hr</span>
              : <span className="text-zinc-700">¢ balance</span>
            }
          </p>
        </div>
        {/* Iron */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Iron</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-zinc-200 tabular-nums">
            {totalIron.toLocaleString()}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-700">units at station</p>
        </div>
        {/* Food */}
        <div className={`rounded-xl border px-4 py-4 ${
          totalFood === 0 && colonies.length > 0
            ? "border-amber-900/50 bg-amber-950/20"
            : "border-zinc-800 bg-zinc-900/80"
        }`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Food</p>
          <p className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${
            totalFood === 0 && colonies.length > 0 ? "text-amber-400" : "text-zinc-200"
          }`}>
            {totalFood.toLocaleString()}
          </p>
          {totalFood === 0 && colonies.length > 0 ? (
            <p className="mt-0.5 text-[10px] text-amber-600">Refine biomass+water</p>
          ) : (
            <p className="mt-0.5 text-[10px] text-zinc-700">units at station</p>
          )}
        </div>
        {/* Inventory total */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Inventory</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-zinc-200 tabular-nums">
            {totalStationUnits.toLocaleString()}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-700">total units</p>
        </div>
      </div>

      {/* ── Station inventory ────────────────────────────────────────────────── */}
      <section>
        <SectionHeading title="Inventory" />
        {stationInventory.length > 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {stationInventory.map((row) => (
                <div
                  key={row.resource_type}
                  className="flex items-center justify-between rounded-lg border border-zinc-700/40 bg-zinc-800/50 px-3 py-2"
                >
                  <span className="text-xs text-zinc-500 capitalize">
                    {row.resource_type.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono text-sm font-semibold text-zinc-200 tabular-nums">
                    {row.quantity.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center">
            <p className="text-sm text-zinc-700">
              Inventory empty — dispatch ships to haul resources from colonies.
            </p>
          </div>
        )}
      </section>

      {/* ── Docked ships ─────────────────────────────────────────────────────── */}
      <section>
        <SectionHeading
          title="Docked Ships"
          meta={<span className="text-zinc-600">{dockedShips.length}</span>}
        />
        {dockedShips.length > 0 ? (
          <div className="space-y-3">
            {dockedShips.map((ship) => {
              const cargo = cargoByShipId.get(ship.id) ?? [];
              const cargoUsed = cargo.reduce((s, r) => s + r.quantity, 0);
              const cargoParts = cargo.map(
                (r) => `${r.quantity} ${r.resource_type.replace(/_/g, " ")}`,
              );
              const cargoSummary = cargoParts.join(", ") || "empty";
              const dispatchTargets = nearbySystems.filter(
                (s) => s.id !== ship.current_system_id,
              );
              const mode = (ship.dispatch_mode ?? "manual") as "manual" | "auto_collect_nearest" | "auto_collect_highest";
              const isAuto = mode !== "manual";
              const dockedPinnedLabel = ship.pinned_colony_id
                ? colonySystemNameById.get(ship.pinned_colony_id)
                : undefined;

              return (
                <div
                  key={ship.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/70 overflow-hidden"
                >
                  {/* Ship header */}
                  <div className="flex items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-zinc-200">{ship.name}</p>
                        {isAuto && dockedPinnedLabel && (
                          <span className="rounded border border-indigo-900/50 bg-indigo-950/50 px-1.5 py-0.5 text-xs text-indigo-400">
                            → {dockedPinnedLabel}
                          </span>
                        )}
                        {isAuto && !dockedPinnedLabel && (
                          <span className="text-xs text-zinc-700">unassigned</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-600">
                        <span>{Number(ship.speed_ly_per_hr).toFixed(1)} ly/hr</span>
                        <span className="mx-1.5 text-zinc-700">·</span>
                        <span className={cargoUsed > 0 ? "text-teal-400" : "text-zinc-700"}>
                          {cargoUsed > 0 ? `${cargoUsed}/${ship.cargo_cap} cargo` : "cargo empty"}
                        </span>
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {isAuto && (
                        <span className="rounded border border-teal-800/50 bg-teal-950/50 px-2 py-0.5 text-xs font-medium text-teal-400">
                          {dispatchModeLabel(mode)}
                        </span>
                      )}
                      <span className="rounded-full border border-emerald-900/40 bg-emerald-950/40 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                        ● Docked
                      </span>
                    </div>
                  </div>

                  {/* Cargo section — only when ship has cargo */}
                  {cargo.length > 0 && (
                    <div className="border-t border-zinc-800 px-5 py-3 bg-zinc-950/30">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-2">
                        Cargo
                      </p>
                      <p className="text-xs text-zinc-300 mb-2.5">{cargoSummary}</p>
                      {/* Auto ships unload automatically — no manual button needed */}
                      {!isAuto && <UnloadButton shipId={ship.id} summary={cargoSummary} />}
                      {isAuto && (
                        <p className="text-xs text-zinc-600">Auto-unloading on arrival…</p>
                      )}
                    </div>
                  )}

                  {/* Haul mode */}
                  <div className="border-t border-zinc-800 px-5 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-2">
                      Haul Mode
                    </p>
                    <ShipModeButton shipId={ship.id} currentMode={mode} />
                    {isAuto && (
                      <p className="mt-1.5 text-xs text-zinc-700">
                        Auto ships collect colony stockpiles and return here automatically.
                      </p>
                    )}
                  </div>

                  {/* Colony assignment — only in auto mode */}
                  {isAuto && colonySelectOptions.length > 0 && (
                    <div className="border-t border-zinc-800 px-5 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-2">
                        Assigned Colony
                      </p>
                      {ship.pinned_colony_id ? (
                        <p className="text-xs text-indigo-400 mb-2">
                          {colonySelectOptions.find((c) => c.id === ship.pinned_colony_id)?.label ?? "Unknown"}
                        </p>
                      ) : (
                        <p className="text-xs text-zinc-600 mb-2">None — auto-select highest available</p>
                      )}
                      <ShipAssignColonyControl
                        shipId={ship.id}
                        currentPinnedColonyId={ship.pinned_colony_id ?? null}
                        colonies={colonySelectOptions}
                      />
                    </div>
                  )}

                  {/* Manual dispatch — only in manual mode */}
                  {mode === "manual" && dispatchTargets.length > 0 && (
                    <div className="border-t border-zinc-800 px-5 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-1">
                        Dispatch To{" "}
                        <span className="text-zinc-700 font-normal normal-case tracking-normal">(★ = colony system)</span>
                      </p>
                      <ShipDispatchForm shipId={ship.id} targetSystems={dispatchTargets} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center">
            <p className="text-sm text-zinc-700">No ships docked at station.</p>
          </div>
        )}
      </section>

      {/* ── Ships away ───────────────────────────────────────────────────────── */}
      {allShipsAway > 0 && (
        <section>
          <SectionHeading title="Ships Away" meta={<span className="text-zinc-600">{allShipsAway}</span>} />
          <div className="space-y-2.5">
            {[...awayShips, ...travelingShips].map((ship) => {
              const mode = (ship.dispatch_mode ?? "manual") as "manual" | "auto_collect_nearest" | "auto_collect_highest";
              const autoState = ship.auto_state as string | null;
              const isAuto = mode !== "manual";
              const targetSystemName = ship.auto_target_colony_id
                ? colonySystemNameById.get(ship.auto_target_colony_id)
                : undefined;
              const pinnedColonySystemName = ship.pinned_colony_id
                ? colonySystemNameById.get(ship.pinned_colony_id)
                : undefined;
              const isIdleAuto = isAuto && (autoState === "idle" || autoState === null);
              const isTraveling = ship.current_system_id === null;
              const destName = ship.destination_system_id
                ? systemDisplayName(ship.destination_system_id)
                : null;

              // ETA for traveling ships
              const arriveAtStr = isTraveling ? arriveAtByShipId.get(ship.id) : undefined;
              const etaMs = arriveAtStr
                ? new Date(arriveAtStr).getTime() - requestTime.getTime()
                : null;
              const etaLabel = etaMs !== null ? formatEtaMs(Math.max(0, etaMs)) : null;

              // Travel purpose line
              const travelPurpose: string | null = isTraveling
                ? autoState === "traveling_to_colony"
                  ? `Collecting → ${targetSystemName ?? destName ?? "colony"}`
                  : autoState === "traveling_to_station"
                    ? `Returning to station`
                    : destName
                      ? `→ ${destName}`
                      : "In transit"
                : null;

              return (
                <div
                  key={ship.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-zinc-300">{ship.name}</p>
                        {pinnedColonySystemName && (
                          <span className="rounded border border-indigo-900/50 bg-indigo-950/50 px-1.5 py-0.5 text-xs text-indigo-400">
                            → {pinnedColonySystemName}
                          </span>
                        )}
                        {isAuto && !pinnedColonySystemName && (
                          <span className="text-xs text-zinc-700">unassigned</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs">
                        {isTraveling ? (
                          <span className="text-indigo-400">{travelPurpose}</span>
                        ) : (
                          <span className="text-zinc-500">{systemDisplayName(ship.current_system_id!)}</span>
                        )}
                        {isAuto && !isTraveling && (
                          <span className="ml-1.5 text-teal-500">
                            · {autoStateLabel(autoState as Parameters<typeof autoStateLabel>[0], targetSystemName)}
                          </span>
                        )}
                        {etaLabel && (
                          <span className="ml-1.5 text-zinc-600">· ETA {etaLabel}</span>
                        )}
                      </p>
                      {isIdleAuto && !isTraveling && (
                        <p className="mt-0.5 text-xs text-zinc-700">
                          Waiting for colony resources to accumulate.
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {isAuto ? (
                        <span className="rounded border border-teal-800/50 bg-teal-950/50 px-2 py-0.5 text-xs font-medium text-teal-400">
                          {dispatchModeLabel(mode)}
                        </span>
                      ) : (
                        isTraveling && (
                          <span className="rounded border border-indigo-900/40 bg-indigo-950/40 px-2 py-0.5 text-xs text-indigo-500">
                            In transit
                          </span>
                        )
                      )}
                      {ship.current_system_id && (
                        <Link
                          href={`/game/system/${encodeURIComponent(ship.current_system_id)}`}
                          className="text-xs text-zinc-600 hover:text-indigo-400 transition-colors"
                        >
                          System →
                        </Link>
                      )}
                    </div>
                  </div>
                  {/* Mode controls */}
                  <div className="border-t border-zinc-800 px-5 py-2.5">
                    <ShipModeButton shipId={ship.id} currentMode={mode} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Colonies ─────────────────────────────────────────────────────────── */}
      {colonies.length > 0 && (
        <section>
          <SectionHeading
            title={`Colonies (${colonies.length})`}
            meta={
              <span className="flex items-center gap-1.5">
                {servedCount > 0 && (
                  <span className="text-indigo-600">{servedCount} served</span>
                )}
                {servedCount > 0 && unservedCount > 0 && (
                  <span className="text-zinc-800">·</span>
                )}
                {unservedCount > 0 && (
                  <span className="font-semibold text-amber-600">{unservedCount} unserved</span>
                )}
              </span>
            }
          />
          <div className="space-y-2.5">
            {colonies.map((colony) => {
              const stockpile = colonyStockpileTotals.get(colony.id) ?? 0;
              const bodyIdx = colony.body_id.slice(colony.body_id.lastIndexOf(":") + 1);
              const pinnedShips = pinnedShipNamesByColonyId.get(colony.id) ?? [];
              const isServed = pinnedShips.length > 0;

              return (
                <div
                  key={colony.id}
                  className={`rounded-xl border px-5 py-3.5 ${
                    isServed
                      ? "border-zinc-800 bg-zinc-900/70"
                      : "border-amber-900/30 bg-zinc-900/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/* Colony name row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-300">
                          {systemDisplayName(colony.system_id)}
                        </p>
                        <span className="text-xs text-zinc-600">Body {bodyIdx}</span>
                        <span className="rounded border border-zinc-700/50 bg-zinc-800/70 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500">
                          T{colony.population_tier}
                        </span>
                      </div>
                      {/* Status row */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {stockpile > 0 ? (
                          <span className="text-xs font-medium text-teal-400">
                            {stockpile.toLocaleString()} u ready
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-700">Empty stockpile</span>
                        )}
                        {isServed ? (
                          <span className="flex items-center gap-1 flex-wrap">
                            {pinnedShips.map((name) => (
                              <span
                                key={name}
                                className="rounded border border-indigo-900/50 bg-indigo-950/50 px-1.5 py-0.5 text-xs text-indigo-400"
                              >
                                {name}
                              </span>
                            ))}
                            <span className="text-xs text-indigo-700">assigned</span>
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-amber-600">
                            ⚠ No ship assigned
                          </span>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/game/colony/${colony.id}`}
                      className="shrink-0 rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200 transition-colors"
                    >
                      Details →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Refining ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionHeading title="Refining" />
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
          <p className="text-xs text-zinc-600 mb-4">
            Convert raw resources into refined materials at the station.
          </p>
          <RefineForm />
        </div>
      </section>

    </div>
  );
}
