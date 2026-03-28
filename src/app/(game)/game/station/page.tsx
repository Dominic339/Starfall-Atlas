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

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Station — Starfall Atlas",
};

export default async function StationPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // Resolve colony growth, upkeep, biomass→food conversion, and passive
  // extraction so colony inventories are current before auto-haul reads them.
  const requestTime = new Date();
  await runEngineTick(admin, player.id, requestTime);

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
        <h1 className="text-xl font-semibold text-zinc-100">Station</h1>
        <p className="text-sm text-zinc-500">
          No station found. Visit the{" "}
          <Link href="/game/map" className="text-indigo-400 hover:text-indigo-300">
            Galaxy Map
          </Link>{" "}
          to trigger bootstrap.
        </p>
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
  // Annotate entries that have an active colony so they're easy to spot in the dropdown.
  const colonySystemIds = new Set(colonies.map((c) => c.system_id as string));
  const nearbySystems = getNearbySystems(station.current_system_id, BALANCE.lanes.baseRangeLy).map(
    (s) => ({
      id: s.id,
      name: colonySystemIds.has(s.id) ? `${s.name} ★` : s.name,
    }),
  );

  const allShipsAway = awayShips.length + travelingShips.length;

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-8">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">{station.name}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            <Link
              href={`/game/system/${encodeURIComponent(station.current_system_id)}`}
              className="text-amber-500 hover:text-amber-400 transition-colors"
            >
              {systemDisplayName(station.current_system_id)}
            </Link>
            {" · "}
            <span className="text-zinc-600">logistics hub</span>
          </p>
        </div>
        <Link
          href="/game/map"
          className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-colors"
        >
          Galaxy Map →
        </Link>
      </div>

      {/* ── Summary bar ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-amber-900/40 bg-zinc-900 px-4 py-3">
          <p className="text-xs text-zinc-600 uppercase tracking-wider">Credits</p>
          <p className="mt-0.5 font-mono text-xl font-semibold text-amber-300">
            {player.credits.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
          <p className="text-xs text-zinc-600 uppercase tracking-wider">Iron</p>
          <p className="mt-0.5 font-mono text-xl font-semibold text-zinc-200">
            {totalIron.toLocaleString()}
          </p>
        </div>
        <div className={`rounded-lg border px-4 py-3 ${
          totalFood === 0 && colonies.length > 0
            ? "border-amber-900/50 bg-amber-950/20"
            : "border-zinc-800 bg-zinc-900"
        }`}>
          <p className="text-xs text-zinc-600 uppercase tracking-wider">Food</p>
          <p className={`mt-0.5 font-mono text-xl font-semibold ${
            totalFood === 0 && colonies.length > 0 ? "text-amber-400" : "text-zinc-200"
          }`}>
            {totalFood.toLocaleString()}
          </p>
          {totalFood === 0 && colonies.length > 0 && (
            <p className="text-xs text-amber-600 mt-0.5">Refine biomass+water</p>
          )}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
          <p className="text-xs text-zinc-600 uppercase tracking-wider">Inventory</p>
          <p className="mt-0.5 font-mono text-xl font-semibold text-zinc-200">
            {totalStationUnits.toLocaleString()}
            <span className="text-sm font-normal text-zinc-600"> units</span>
          </p>
        </div>
      </div>

      {/* ── Station inventory ───────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Inventory
        </h2>
        {stationInventory.length > 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {stationInventory.map((row) => (
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
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center">
            <p className="text-sm text-zinc-600">
              Inventory empty — dispatch ships to haul resources from colonies.
            </p>
          </div>
        )}
      </section>

      {/* ── Docked ships ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Docked Ships ({dockedShips.length})
        </h2>
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
              const dockedPinnedLabel = ship.pinned_colony_id
                ? colonySystemNameById.get(ship.pinned_colony_id)
                : undefined;
              return (
                <div
                  key={ship.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 space-y-3"
                >
                  {/* Ship header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-200">{ship.name}</p>
                        {mode !== "manual" && dockedPinnedLabel && (
                          <span className="rounded border border-indigo-900/50 bg-indigo-950/40 px-1.5 py-0.5 text-xs text-indigo-400">
                            → {dockedPinnedLabel}
                          </span>
                        )}
                        {mode !== "manual" && !dockedPinnedLabel && (
                          <span className="text-xs text-zinc-700">unassigned</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">
                        {Number(ship.speed_ly_per_hr).toFixed(1)} ly/hr
                        {" · "}
                        <span className={cargoUsed > 0 ? "text-teal-400" : "text-zinc-600"}>
                          {cargoUsed}/{ship.cargo_cap} cargo
                        </span>
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-900/40 border border-emerald-900/30 px-2 py-0.5 text-xs text-emerald-400 shrink-0">
                      Docked
                    </span>
                  </div>

                  {/* Cargo / unload */}
                  <div className="border-t border-zinc-800 pt-2">
                    {cargo.length > 0 ? (
                      <>
                        <p className="text-xs text-zinc-500 mb-1.5">
                          Cargo: <span className="text-zinc-300">{cargoSummary}</span>
                        </p>
                        <UnloadButton shipId={ship.id} summary={cargoSummary} />
                      </>
                    ) : (
                      <p className="text-xs text-zinc-700">No cargo to unload.</p>
                    )}
                  </div>

                  {/* Haul mode */}
                  <div className="border-t border-zinc-800 pt-2">
                    <p className="text-xs text-zinc-600 mb-1.5">
                      Mode:{" "}
                      <span className={mode !== "manual" ? "text-teal-400 font-medium" : "text-zinc-400"}>
                        {dispatchModeLabel(mode)}
                      </span>
                    </p>
                    <ShipModeButton shipId={ship.id} currentMode={mode} />
                    {mode !== "manual" && (
                      <p className="mt-1.5 text-xs text-zinc-700">
                        Auto ships collect colony stockpiles and return here automatically.
                        Colony resources accumulate passively — no manual action needed.
                      </p>
                    )}
                  </div>

                  {/* Colony assignment — only visible in auto mode */}
                  {mode !== "manual" && colonySelectOptions.length > 0 && (
                    <div className="border-t border-zinc-800 pt-2">
                      <p className="text-xs text-zinc-600 mb-1.5">
                        Assigned colony:{" "}
                        {ship.pinned_colony_id ? (
                          <span className="text-indigo-400">
                            {colonySelectOptions.find((c) => c.id === ship.pinned_colony_id)?.label ?? "Unknown"}
                          </span>
                        ) : (
                          <span className="text-zinc-600">None (auto-select)</span>
                        )}
                      </p>
                      <ShipAssignColonyControl
                        shipId={ship.id}
                        currentPinnedColonyId={ship.pinned_colony_id ?? null}
                        colonies={colonySelectOptions}
                      />
                    </div>
                  )}
                  {/* Manual dispatch — only when in manual mode */}
                  {mode === "manual" && dispatchTargets.length > 0 && (
                    <div className="border-t border-zinc-800 pt-2">
                      <p className="text-xs text-zinc-600 mb-1">
                        Send to:{" "}
                        <span className="text-zinc-700 font-normal">(★ = colony system)</span>
                      </p>
                      <ShipDispatchForm
                        shipId={ship.id}
                        targetSystems={dispatchTargets}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-center">
            <p className="text-sm text-zinc-600">No ships docked at station.</p>
          </div>
        )}
      </section>

      {/* ── Ships away ──────────────────────────────────────────────────────── */}
      {allShipsAway > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Ships Away ({allShipsAway})
          </h2>
          <div className="space-y-2">
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

              // Travel purpose line: what the ship is doing while in transit
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
                  className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3 space-y-2"
                >
                  {/* Ship header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-300">{ship.name}</p>
                        {pinnedColonySystemName && (
                          <span className="rounded border border-indigo-900/50 bg-indigo-950/40 px-1.5 py-0.5 text-xs text-indigo-400">
                            → {pinnedColonySystemName}
                          </span>
                        )}
                        {isAuto && !pinnedColonySystemName && (
                          <span className="text-xs text-zinc-700">unassigned</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-600">
                        {isTraveling ? (
                          <span className="text-indigo-400">{travelPurpose}</span>
                        ) : (
                          systemDisplayName(ship.current_system_id!)
                        )}
                        {isAuto && !isTraveling && (
                          <span className="ml-2 text-teal-500">
                            · {autoStateLabel(autoState as Parameters<typeof autoStateLabel>[0], targetSystemName)}
                          </span>
                        )}
                        {etaLabel && (
                          <span className="ml-2 text-zinc-500">· ETA {etaLabel}</span>
                        )}
                      </p>
                      {isIdleAuto && !isTraveling && (
                        <p className="mt-0.5 text-xs text-zinc-600">
                          Idle — waiting for colony resources to accumulate.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isAuto && (
                        <span className="rounded px-1.5 py-0.5 text-xs bg-teal-900/40 text-teal-400 border border-teal-900/30">
                          {dispatchModeLabel(mode)}
                        </span>
                      )}
                      {ship.current_system_id && (
                        <Link
                          href={`/game/system/${encodeURIComponent(ship.current_system_id)}`}
                          className="text-xs text-indigo-500 hover:text-indigo-300 transition-colors"
                        >
                          System →
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* Mode controls */}
                  <div className="border-t border-zinc-800 pt-2">
                    <p className="text-xs text-zinc-700 mb-1">Mode:</p>
                    <ShipModeButton shipId={ship.id} currentMode={mode} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Colonies ────────────────────────────────────────────────────────── */}
      {colonies.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Colonies ({colonies.length})
            </h2>
            {colonies.length > 0 && (
              <span className="text-xs text-zinc-700">
                {servedCount > 0 && (
                  <span className="text-indigo-500">{servedCount} served</span>
                )}
                {servedCount > 0 && unservedCount > 0 && (
                  <span className="text-zinc-700"> · </span>
                )}
                {unservedCount > 0 && (
                  <span className="text-amber-500">{unservedCount} unserved</span>
                )}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {colonies.map((colony) => {
              const stockpile = colonyStockpileTotals.get(colony.id) ?? 0;
              const bodyIdx = colony.body_id.slice(colony.body_id.lastIndexOf(":") + 1);
              const pinnedShips = pinnedShipNamesByColonyId.get(colony.id) ?? [];
              const isServed = pinnedShips.length > 0;
              return (
                <div
                  key={colony.id}
                  className={`rounded-lg border px-4 py-2.5 ${
                    isServed
                      ? "border-zinc-800 bg-zinc-900/70"
                      : "border-amber-900/30 bg-zinc-900/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-300">
                        {systemDisplayName(colony.system_id)}
                        <span className="ml-1.5 text-xs text-zinc-600">· Body {bodyIdx}</span>
                        <span className="ml-1.5 text-xs text-zinc-600">T{colony.population_tier}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {/* Stockpile status */}
                        {stockpile > 0 ? (
                          <span className="text-xs text-teal-400">
                            {stockpile.toLocaleString()} u ready
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-700">Empty stockpile</span>
                        )}
                        {/* Coverage indicator */}
                        {isServed ? (
                          <span className="flex items-center gap-1 flex-wrap">
                            {pinnedShips.map((name) => (
                              <span
                                key={name}
                                className="rounded border border-indigo-900/50 bg-indigo-950/40 px-1.5 py-0.5 text-xs text-indigo-400"
                              >
                                {name}
                              </span>
                            ))}
                            <span className="text-xs text-indigo-600">assigned</span>
                          </span>
                        ) : (
                          <span className="text-xs text-amber-600">No ship assigned</span>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/game/colony/${colony.id}`}
                      className="text-xs text-indigo-500 hover:text-indigo-300 transition-colors shrink-0"
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

      {/* ── Refining ────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Refine
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
          <RefineForm />
        </div>
      </section>
    </div>
  );
}
