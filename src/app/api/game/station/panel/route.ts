/**
 * GET /api/game/station/panel
 *
 * Returns all data needed for the StationMapPanel overlay — inventory,
 * fleet status, colonies, refine options, and dispatch targets.
 * Runs engine tick + travel resolution so data is current.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getNearbySystems, systemDisplayName } from "@/lib/catalog";
import { BALANCE } from "@/lib/config/balance";
import { taxRateForTier } from "@/lib/game/taxes";
import { dispatchModeLabel, autoStateLabel } from "@/lib/game/shipAutomation";
import { runEngineTick } from "@/lib/game/engineTick";
import { runTravelResolution } from "@/lib/game/travelResolution";
import type { Player, Ship, PlayerStation, ResourceInventoryRow, Colony } from "@/lib/types/game";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data as { player: Player };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const now = new Date();
  await Promise.all([
    runEngineTick(admin, player.id, now),
    runTravelResolution(admin, player.id, now),
  ]);

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
  if (!station) {
    return Response.json({ ok: false, error: { message: "No station found." } });
  }

  const ships = listResult<Ship>(shipsRes).data ?? [];

  type ColonyRow = Pick<Colony, "id" | "system_id" | "body_id" | "status" | "population_tier">;
  const colonies = listResult<ColonyRow>(coloniesRes).data ?? [];

  const creditsPerHour = colonies.reduce(
    (sum, c) => sum + taxRateForTier(c.population_tier),
    0,
  );

  const colonyById = new Map(colonies.map((c) => [c.id, c]));
  const dockedShipIds = ships.filter((s) => s.current_system_id === station.current_system_id).map((s) => s.id);
  const activeColonyIds = colonies.map((c) => c.id);

  // Pinned ship names per colony
  const pinnedShipNamesByColonyId = new Map<string, string[]>();
  for (const ship of ships) {
    if (ship.pinned_colony_id) {
      const list = pinnedShipNamesByColonyId.get(ship.pinned_colony_id) ?? [];
      list.push(ship.name);
      pinnedShipNamesByColonyId.set(ship.pinned_colony_id, list);
    }
  }

  const [invRes, cargoRes, colonyInvRes, travelJobsRes] = await Promise.all([
    admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .order("resource_type", { ascending: true }),
    dockedShipIds.length > 0
      ? admin.from("resource_inventory").select("location_id, resource_type, quantity").eq("location_type", "ship").in("location_id", dockedShipIds)
      : Promise.resolve({ data: [] }),
    activeColonyIds.length > 0
      ? admin.from("resource_inventory").select("location_id, quantity").eq("location_type", "colony").in("location_id", activeColonyIds)
      : Promise.resolve({ data: [] }),
    admin.from("travel_jobs").select("ship_id, arrive_at").eq("player_id", player.id).eq("status", "pending"),
  ]);

  const stationInventory = (invRes.data ?? []) as Pick<ResourceInventoryRow, "resource_type" | "quantity">[];
  const invMap = new Map(stationInventory.map((r) => [r.resource_type, r.quantity]));

  type CargoRow = Pick<ResourceInventoryRow, "resource_type" | "quantity"> & { location_id: string };
  const cargoByShipId = new Map<string, { resource: string; quantity: number }[]>();
  for (const row of (cargoRes.data ?? []) as CargoRow[]) {
    const list = cargoByShipId.get(row.location_id) ?? [];
    list.push({ resource: row.resource_type, quantity: row.quantity });
    cargoByShipId.set(row.location_id, list);
  }

  type ColonyInvRow = { location_id: string; quantity: number };
  const colonyStockpileTotals = new Map<string, number>();
  for (const row of (colonyInvRes.data ?? []) as ColonyInvRow[]) {
    colonyStockpileTotals.set(row.location_id, (colonyStockpileTotals.get(row.location_id) ?? 0) + row.quantity);
  }

  type TravelJobRow = { ship_id: string; arrive_at: string };
  const arriveAtByShipId = new Map<string, string>(
    ((travelJobsRes.data ?? []) as TravelJobRow[]).map((tj) => [tj.ship_id, tj.arrive_at]),
  );

  const stationSystemName = systemDisplayName(station.current_system_id);
  const colonySystemIds = new Set(colonies.map((c) => c.system_id as string));
  const nearbySystemsForDispatch = getNearbySystems(station.current_system_id, BALANCE.lanes.baseRangeLy)
    .map((s) => ({ id: s.id, name: colonySystemIds.has(s.id) ? `${s.name} ★` : s.name }));

  const mappedShips = ships.map((ship) => {
    const cargo = cargoByShipId.get(ship.id) ?? [];
    const cargoUsed = cargo.reduce((s, r) => s + r.quantity, 0);
    const isDocked = ship.current_system_id === station.current_system_id;
    const isTraveling = ship.current_system_id === null;
    const isAway = !isDocked && !isTraveling;
    const arriveAt = arriveAtByShipId.get(ship.id) ?? null;
    const mode = (ship.dispatch_mode ?? "manual") as string;
    const pinnedColony = ship.pinned_colony_id ? colonyById.get(ship.pinned_colony_id) : null;
    const pinnedColonyLabel = pinnedColony
      ? `${systemDisplayName(pinnedColony.system_id)} · Body ${pinnedColony.body_id.slice(pinnedColony.body_id.lastIndexOf(":") + 1)}`
      : null;
    const autoTargetColony = ship.auto_target_colony_id ? colonyById.get(ship.auto_target_colony_id) : null;
    const autoTargetName = autoTargetColony ? systemDisplayName(autoTargetColony.system_id) : undefined;

    return {
      id: ship.id,
      name: ship.name,
      cargoCap: ship.cargo_cap,
      speedLyPerHr: Number(ship.speed_ly_per_hr),
      dispatchMode: mode,
      dispatchModeLabel: dispatchModeLabel(mode),
      cargoUsed,
      cargo,
      isDocked,
      isTraveling,
      isAway,
      currentSystemId: ship.current_system_id ?? null,
      currentSystemName: ship.current_system_id ? systemDisplayName(ship.current_system_id) : null,
      destinationSystemId: ship.destination_system_id ?? null,
      destinationSystemName: ship.destination_system_id ? systemDisplayName(ship.destination_system_id) : null,
      arriveAt,
      pinnedColonyId: ship.pinned_colony_id ?? null,
      pinnedColonyLabel,
      autoState: ship.auto_state ?? null,
      autoStateLabel: autoStateLabel(ship.auto_state as Parameters<typeof autoStateLabel>[0], autoTargetName),
    };
  });

  const mappedColonies = colonies.map((c) => {
    const bodyIndex = c.body_id.slice(c.body_id.lastIndexOf(":") + 1);
    return {
      id: c.id,
      systemId: c.system_id,
      systemName: systemDisplayName(c.system_id),
      bodyIndex,
      populationTier: c.population_tier,
      stockpileTotal: colonyStockpileTotals.get(c.id) ?? 0,
      isServed: pinnedShipNamesByColonyId.has(c.id),
      pinnedShipNames: pinnedShipNamesByColonyId.get(c.id) ?? [],
    };
  });

  // Compute refine options
  const refineOptions = Object.entries(BALANCE.refining.recipes).map(([output, recipe]) => {
    const maxBatches = recipe.inputs.reduce((min, inp) => {
      const have = invMap.get(inp.resource_type) ?? 0;
      return Math.min(min, Math.floor(have / inp.quantity));
    }, Infinity);
    const canAfford = maxBatches > 0;
    return {
      output,
      inputs: recipe.inputs.map((i) => ({ resource: i.resource_type, quantity: i.quantity })),
      maxBatches: maxBatches === Infinity ? 0 : maxBatches,
      canAfford,
    };
  });

  return Response.json({
    ok: true,
    data: {
      station: {
        id: station.id,
        name: station.name,
        systemId: station.current_system_id,
        systemName: stationSystemName,
      },
      credits: player.credits,
      creditsPerHour,
      inventory: stationInventory.map((r) => ({ resource: r.resource_type, quantity: r.quantity })),
      totalUnits: stationInventory.reduce((s, r) => s + r.quantity, 0),
      ships: mappedShips,
      colonies: mappedColonies,
      nearbySystemsForDispatch,
      refineOptions,
    },
  });
}
