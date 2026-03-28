/**
 * Travel resolution — ship state machine advancement.
 *
 * Extracted from command/page.tsx Steps 5 and 5.5.
 * Called directly by the command page (server component) and also exposed as
 * POST /api/engine/resolve-travel for client-side or tooling use.
 *
 * Resolves:
 *   - Arrived travel_jobs: marks complete, lands ships at destination
 *   - Auto-mode ships: advances state machine (load ↔ travel ↔ unload cycle)
 *   - Fleet travel: marks fleet active when all member ships arrive
 *
 * Writes ship_state, last_known_system_id, destination_system_id to keep
 * the new unified state model in sync after every resolution.
 */

import { getCatalogEntry } from "@/lib/catalog";
import { distanceBetween, computeArrivalTime } from "@/lib/game/travel";
import { rankColonyCandidates } from "@/lib/game/shipAutomation";
import { BALANCE } from "@/lib/config/balance";
import type { Ship, TravelJob, Colony, PlayerStation, Player } from "@/lib/types/game";
import type { SystemId, ColonyId } from "@/lib/types/game";

export interface TravelResolutionResult {
  jobsResolved: number;
  shipsAutoAdvanced: number;
  fleetsArrived: number;
}

/**
 * Resolves all pending travel and advances auto-ship state machines.
 *
 * @param admin       Service-role Supabase client
 * @param playerId    Player UUID
 * @param requestTime Timestamp to use as "now"
 */
export async function runTravelResolution(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  playerId: string,
  requestTime: Date = new Date(),
): Promise<TravelResolutionResult> {
  // ── 1. Fetch player station ────────────────────────────────────────────────
  const { data: stationRow } = await admin
    .from("player_stations")
    .select("id, current_system_id")
    .eq("owner_id", playerId)
    .maybeSingle();

  const station = stationRow as PlayerStation | null;

  // ── 2. Fetch all player ships ──────────────────────────────────────────────
  const { data: shipRows } = await admin
    .from("ships")
    .select("*")
    .eq("owner_id", playerId);

  let ships: Ship[] = (shipRows ?? []) as Ship[];
  if (ships.length === 0) {
    return { jobsResolved: 0, shipsAutoAdvanced: 0, fleetsArrived: 0 };
  }

  // ── 3. Fetch pending travel jobs ───────────────────────────────────────────
  const { data: jobRows } = await admin
    .from("travel_jobs")
    .select("*")
    .eq("player_id", playerId)
    .eq("status", "pending");

  const allTravelJobs: TravelJob[] = (jobRows ?? []) as TravelJob[];
  const travelJobByShipId = new Map(allTravelJobs.map((j) => [j.ship_id, j]));

  // ── 4. Fetch active colonies ────────────────────────────────────────────────
  const { data: colonyRows } = await admin
    .from("colonies")
    .select("id, system_id, status")
    .eq("owner_id", playerId)
    .eq("status", "active");

  const colonies: Pick<Colony, "id" | "system_id" | "status">[] = colonyRows ?? [];

  // ── 5. Fetch colony inventories ────────────────────────────────────────────
  const colonyIds = colonies.map((c) => c.id);
  const colonyInvByColonyId = new Map<string, { resource_type: string; quantity: number }[]>();
  const colonyInvTotals = new Map<string, number>();

  if (colonyIds.length > 0) {
    const { data: colonyInvRows } = await admin
      .from("resource_inventory")
      .select("location_id, resource_type, quantity")
      .eq("location_type", "colony")
      .in("location_id", colonyIds);

    for (const row of (colonyInvRows ?? []) as { location_id: string; resource_type: string; quantity: number }[]) {
      const list = colonyInvByColonyId.get(row.location_id) ?? [];
      list.push({ resource_type: row.resource_type, quantity: row.quantity });
      colonyInvByColonyId.set(row.location_id, list);
      colonyInvTotals.set(row.location_id, (colonyInvTotals.get(row.location_id) ?? 0) + row.quantity);
    }
  }

  // ── 6. Fetch ship cargo ────────────────────────────────────────────────────
  const shipIds = ships.map((s) => s.id);
  const cargoByShipId = new Map<string, { resource_type: string; quantity: number }[]>();

  const { data: cargoRows } = await admin
    .from("resource_inventory")
    .select("location_id, resource_type, quantity")
    .eq("location_type", "ship")
    .in("location_id", shipIds);

  for (const row of (cargoRows ?? []) as { location_id: string; resource_type: string; quantity: number }[]) {
    const list = cargoByShipId.get(row.location_id) ?? [];
    list.push({ resource_type: row.resource_type, quantity: row.quantity });
    cargoByShipId.set(row.location_id, list);
  }

  // ── 7. Fetch fleets and their member ships ─────────────────────────────────
  type FleetRow = { id: string; player_id: string; name: string; status: string; current_system_id: string | null; fleet_ships: { ship_id: string }[] };
  const { data: fleetRows } = await admin
    .from("fleets")
    .select("id, player_id, name, status, current_system_id, fleet_ships(ship_id)")
    .eq("player_id", playerId)
    .neq("status", "disbanded");

  const fleets: FleetRow[] = (fleetRows ?? []) as FleetRow[];
  const shipIdsInFleet = new Set(fleets.flatMap((f) => f.fleet_ships.map((fs) => fs.ship_id)));
  const shipIdsByFleetId = new Map(fleets.map((f) => [f.id, f.fleet_ships.map((fs) => fs.ship_id)]));

  let jobsResolved = 0;
  let shipsAutoAdvanced = 0;
  let fleetsArrived = 0;

  // ── 8. Resolve auto-mode ships (Step 5 equivalent) ────────────────────────
  if (station) {
    const st = station;
    const resolvedShips: Ship[] = [...ships];

    for (let si = 0; si < resolvedShips.length; si++) {
      let ship = resolvedShips[si];
      if (ship.dispatch_mode === "manual") continue;
      if (shipIdsInFleet.has(ship.id)) continue;

      const mode = ship.dispatch_mode as "auto_collect_nearest" | "auto_collect_highest";

      // 8a. Resolve arrived travel job
      const pendingJob = travelJobByShipId.get(ship.id);
      if (pendingJob) {
        if (new Date(pendingJob.arrive_at) <= requestTime) {
          await admin.from("travel_jobs").update({ status: "complete" }).eq("id", pendingJob.id);
          await admin.from("ships").update({
            current_system_id: pendingJob.to_system_id,
            current_body_id: null,
            ship_state: "idle_at_station",
            last_known_system_id: pendingJob.to_system_id,
            destination_system_id: null,
          }).eq("id", ship.id);
          ship = {
            ...ship,
            current_system_id: pendingJob.to_system_id as SystemId,
            current_body_id: null,
            ship_state: "idle_at_station",
            last_known_system_id: pendingJob.to_system_id as SystemId,
            destination_system_id: null,
          };
          travelJobByShipId.delete(ship.id);
          jobsResolved++;
        } else {
          resolvedShips[si] = ship;
          continue;
        }
      }

      // 8b. Advance state machine
      if (ship.auto_state === "traveling_to_colony") {
        const targetColony = colonies.find((c) => c.id === ship.auto_target_colony_id);
        if (targetColony && ship.current_system_id === targetColony.system_id) {
          const loaded = await doLoad(admin, ship, targetColony.id, cargoByShipId, colonyInvByColonyId, colonyInvTotals);
          if (loaded > 0 || (cargoByShipId.get(ship.id) ?? []).length > 0) {
            const departed = await startTravel(admin, ship, st.current_system_id, requestTime, playerId, travelJobByShipId);
            const nextState = departed ? "traveling_to_station" : "idle";
            await admin.from("ships").update({ auto_state: nextState, ship_state: departed ? "traveling" : "idle_at_station" }).eq("id", ship.id);
            ship = { ...ship, auto_state: nextState, ship_state: departed ? "traveling" : "idle_at_station" };
          } else {
            await admin.from("ships").update({ auto_state: "idle", auto_target_colony_id: null, ship_state: "idle_at_station" }).eq("id", ship.id);
            ship = { ...ship, auto_state: "idle", auto_target_colony_id: null, ship_state: "idle_at_station" };
          }
          shipsAutoAdvanced++;
        }
      } else if (ship.auto_state === "traveling_to_station") {
        if (ship.current_system_id === st.current_system_id) {
          await doUnload(admin, ship, st.id, cargoByShipId);
          ship = { ...ship, auto_state: "idle", auto_target_colony_id: null, ship_state: "idle_at_station" };
          ship = await dispatchToNextColony(admin, ship, colonies, colonyInvTotals, mode, st, requestTime, playerId, travelJobByShipId);
          shipsAutoAdvanced++;
        }
      } else {
        // idle or null
        ship = await dispatchToNextColony(admin, ship, colonies, colonyInvTotals, mode, st, requestTime, playerId, travelJobByShipId);
        shipsAutoAdvanced++;
      }

      resolvedShips[si] = ship;
    }

    ships = resolvedShips;
  }

  // ── 9. Resolve fleet travel (Step 5.5 equivalent) ─────────────────────────
  for (let fi = 0; fi < fleets.length; fi++) {
    const fleet = fleets[fi];
    if (fleet.status !== "traveling") continue;

    const memberShipIds = shipIdsByFleetId.get(fleet.id) ?? [];
    if (memberShipIds.length === 0) continue;

    const fleetJobs = allTravelJobs.filter((j) => j.fleet_id === fleet.id);
    if (fleetJobs.length === 0) continue;

    const allArrived = fleetJobs.every((j) => new Date(j.arrive_at) <= requestTime);
    if (!allArrived) continue;

    const destSystemId = fleetJobs[0].to_system_id;

    await admin.from("travel_jobs").update({ status: "complete" }).in("id", fleetJobs.map((j) => j.id));
    await admin.from("ships").update({
      current_system_id: destSystemId,
      current_body_id: null,
      ship_state: "idle_in_system",
      last_known_system_id: destSystemId,
      destination_system_id: null,
    }).in("id", memberShipIds);
    await admin.from("fleets").update({
      status: "active",
      current_system_id: destSystemId,
      updated_at: requestTime.toISOString(),
    }).eq("id", fleet.id);

    fleets[fi] = { ...fleet, status: "active", current_system_id: destSystemId };
    jobsResolved += fleetJobs.length;
    fleetsArrived++;
  }

  return { jobsResolved, shipsAutoAdvanced, fleetsArrived };
}

// ── Private helpers ──────────────────────────────────────────────────────────

/** Load colony inventory into a ship up to its cargo cap. Returns units loaded. */
async function doLoad(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  ship: Ship,
  colonyId: string,
  cargoByShipId: Map<string, { resource_type: string; quantity: number }[]>,
  colonyInvByColonyId: Map<string, { resource_type: string; quantity: number }[]>,
  colonyInvTotals: Map<string, number>,
): Promise<number> {
  const colonyInv = colonyInvByColonyId.get(colonyId) ?? [];
  const currentCargo = cargoByShipId.get(ship.id) ?? [];
  const cargoUsed = currentCargo.reduce((s, r) => s + r.quantity, 0);
  let remaining = ship.cargo_cap - cargoUsed;
  if (remaining <= 0 || colonyInv.length === 0) return 0;

  const toLoad: { resource_type: string; quantity: number }[] = [];
  const leftoverInv: { resource_type: string; quantity: number }[] = [];

  for (const item of colonyInv) {
    const load = Math.min(item.quantity, remaining);
    if (load > 0) {
      toLoad.push({ resource_type: item.resource_type, quantity: load });
      if (item.quantity > load) leftoverInv.push({ resource_type: item.resource_type, quantity: item.quantity - load });
      remaining -= load;
    } else {
      leftoverInv.push(item);
    }
  }

  if (toLoad.length === 0) return 0;

  // Update colony inventory in DB
  for (const item of toLoad) {
    const leftover = leftoverInv.find((r) => r.resource_type === item.resource_type);
    if (!leftover) {
      await admin.from("resource_inventory").delete()
        .eq("location_type", "colony").eq("location_id", colonyId).eq("resource_type", item.resource_type);
    } else {
      await admin.from("resource_inventory").update({ quantity: leftover.quantity })
        .eq("location_type", "colony").eq("location_id", colonyId).eq("resource_type", item.resource_type);
    }
  }

  // Upsert ship cargo in DB
  const existingMap = new Map(currentCargo.map((r) => [r.resource_type, r.quantity]));
  await admin.from("resource_inventory").upsert(
    toLoad.map((item) => ({
      location_type: "ship",
      location_id: ship.id,
      resource_type: item.resource_type,
      quantity: (existingMap.get(item.resource_type) ?? 0) + item.quantity,
    })),
    { onConflict: "location_type,location_id,resource_type" },
  );

  // Update in-memory maps
  colonyInvByColonyId.set(colonyId, leftoverInv);
  colonyInvTotals.set(colonyId, leftoverInv.reduce((s, r) => s + r.quantity, 0));
  const newCargo = [...currentCargo];
  for (const loaded of toLoad) {
    const ex = newCargo.find((r) => r.resource_type === loaded.resource_type);
    if (ex) ex.quantity += loaded.quantity;
    else newCargo.push({ resource_type: loaded.resource_type, quantity: loaded.quantity });
  }
  cargoByShipId.set(ship.id, newCargo);

  return toLoad.reduce((s, r) => s + r.quantity, 0);
}

/** Unload all ship cargo to station. */
async function doUnload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  ship: Ship,
  stationId: string,
  cargoByShipId: Map<string, { resource_type: string; quantity: number }[]>,
): Promise<void> {
  const cargo = cargoByShipId.get(ship.id) ?? [];
  if (cargo.length === 0) return;

  const rtypes = cargo.map((r) => r.resource_type);
  const { data: stRows } = await admin
    .from("resource_inventory")
    .select("resource_type, quantity")
    .eq("location_type", "station")
    .eq("location_id", stationId)
    .in("resource_type", rtypes);

  const stMap = new Map(
    ((stRows ?? []) as { resource_type: string; quantity: number }[]).map((r) => [r.resource_type, r.quantity]),
  );

  await admin.from("resource_inventory").upsert(
    cargo.map((item) => ({
      location_type: "station",
      location_id: stationId,
      resource_type: item.resource_type,
      quantity: (stMap.get(item.resource_type) ?? 0) + item.quantity,
    })),
    { onConflict: "location_type,location_id,resource_type" },
  );

  await admin.from("resource_inventory").delete()
    .eq("location_type", "ship").eq("location_id", ship.id);

  cargoByShipId.set(ship.id, []);

  await admin.from("ships").update({
    auto_state: "idle",
    auto_target_colony_id: null,
    ship_state: "idle_at_station",
  }).eq("id", ship.id);
}

/** Start a travel job from ship's current system to targetSystemId. Returns true on success. */
async function startTravel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  ship: Ship,
  targetSystemId: string,
  requestTime: Date,
  playerId: string,
  travelJobByShipId: Map<string, TravelJob>,
): Promise<boolean> {
  if (!ship.current_system_id) return false;
  const fromEntry = getCatalogEntry(ship.current_system_id);
  const toEntry = getCatalogEntry(targetSystemId);
  if (!fromEntry || !toEntry) return false;

  const dist = distanceBetween(
    { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
    { x: toEntry.x, y: toEntry.y, z: toEntry.z },
  );
  if (dist <= 0 || dist > BALANCE.lanes.baseRangeLy) return false;

  const arriveAt = computeArrivalTime(requestTime, dist, Number(ship.speed_ly_per_hr));

  await admin.from("ships").update({
    current_system_id: null,
    current_body_id: null,
    ship_state: "traveling",
    destination_system_id: targetSystemId,
  }).eq("id", ship.id);

  const { data: newJob } = await admin
    .from("travel_jobs")
    .insert({
      ship_id: ship.id,
      player_id: playerId,
      from_system_id: ship.current_system_id,
      to_system_id: targetSystemId,
      depart_at: requestTime.toISOString(),
      arrive_at: arriveAt.toISOString(),
      transit_tax_paid: 0,
      status: "pending",
    })
    .select("*")
    .maybeSingle();

  if (newJob) travelJobByShipId.set(ship.id, newJob as TravelJob);
  return true;
}

/** Find best target colony and dispatch; returns updated ship. */
async function dispatchToNextColony(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  ship: Ship,
  colonies: Pick<Colony, "id" | "system_id" | "status">[],
  colonyInvTotals: Map<string, number>,
  mode: "auto_collect_nearest" | "auto_collect_highest",
  station: PlayerStation,
  requestTime: Date,
  playerId: string,
  travelJobByShipId: Map<string, TravelJob>,
): Promise<Ship> {
  const fullCandidates = rankColonyCandidates(
    ship,
    colonies as Colony[],
    colonyInvTotals,
    mode,
    ship.pinned_colony_id ?? undefined,
  );

  if (fullCandidates.length === 0) {
    await admin.from("ships").update({
      auto_state: "idle",
      auto_target_colony_id: null,
      ship_state: "idle_at_station",
    }).eq("id", ship.id);
    return { ...ship, auto_state: "idle", auto_target_colony_id: null, ship_state: "idle_at_station" };
  }

  const target = fullCandidates[0];
  await admin.from("ships").update({
    auto_state: "traveling_to_colony",
    auto_target_colony_id: target.colonyId,
    ship_state: "traveling",
    destination_system_id: target.systemId,
  }).eq("id", ship.id);

  ship = {
    ...ship,
    auto_state: "traveling_to_colony",
    auto_target_colony_id: target.colonyId as ColonyId,
    ship_state: "traveling",
    destination_system_id: target.systemId as SystemId,
  };

  if (target.distanceLy === 0) {
    // Same system — no travel job needed; let next resolution cycle handle loading
    return ship;
  }

  const departed = await startTravel(admin, ship, target.systemId, requestTime, playerId, travelJobByShipId);
  if (!departed) {
    await admin.from("ships").update({ auto_state: "idle", auto_target_colony_id: null, ship_state: "idle_at_station", destination_system_id: null }).eq("id", ship.id);
    return { ...ship, auto_state: "idle", auto_target_colony_id: null, ship_state: "idle_at_station", destination_system_id: null };
  }

  return ship;
}
