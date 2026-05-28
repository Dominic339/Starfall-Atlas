/**
 * Colony supply route execution engine.
 *
 * Resolves all overdue colony_routes for a player, transferring resources
 * between colony inventories according to each route's mode and transport
 * capacity. Uses lazy timestamp-based resolution identical to the engine tick.
 *
 * Execution rules:
 *   - A route is due when last_run_at + interval_minutes <= now
 *   - Multiple overdue periods are collapsed into one transfer (not stacked)
 *   - Transfer amount is capped by the from-colony's transport capacity
 *   - Transfer amount is capped by the from-colony's available inventory
 *   - mode 'all'    → transfer entire available quantity (up to cap)
 *   - mode 'excess' → transfer quantity above BALANCE.colonyTransport.excessThreshold
 *   - mode 'fixed'  → transfer exactly fixed_amount (or less if unavailable)
 *   - If from-colony has no transport units, the route is skipped (not penalised)
 *   - last_run_at is advanced to now regardless of whether a transfer occurred
 */

import { BALANCE } from "@/lib/config/balance";

interface ColonyRouteRow {
  id: string;
  player_id: string;
  from_colony_id: string;
  to_colony_id: string;
  resource_type: string;
  mode: "all" | "excess" | "fixed";
  fixed_amount: number | null;
  interval_minutes: number;
  last_run_at: string;
}

interface TransportRow {
  colony_id: string;
  tier: number;
}

interface InventoryRow {
  location_id: string;
  resource_type: string;
  quantity: number;
}

export interface RouteResolutionResult {
  routesRun: number;
  transfersMade: number;
  totalUnitsTransferred: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveColonyRoutes(admin: any, playerId: string, now: Date): Promise<RouteResolutionResult> {
  const nowIso = now.toISOString();

  // Fetch all routes where the next run deadline has passed
  const { data: routeRows } = await admin
    .from("colony_routes")
    .select("id, player_id, from_colony_id, to_colony_id, resource_type, mode, fixed_amount, interval_minutes, last_run_at")
    .eq("player_id", playerId);

  const routes = (routeRows ?? []) as ColonyRouteRow[];
  const dueRoutes = routes.filter((r) => {
    const nextRun = new Date(r.last_run_at).getTime() + r.interval_minutes * 60_000;
    return nextRun <= now.getTime();
  });

  if (dueRoutes.length === 0) return { routesRun: 0, transfersMade: 0, totalUnitsTransferred: 0 };

  // Collect all unique colony IDs involved
  const colonyIds = [...new Set([
    ...dueRoutes.map((r) => r.from_colony_id),
    ...dueRoutes.map((r) => r.to_colony_id),
  ])];

  // Fetch transports and inventories in parallel
  const [transportsRes, inventoryRes] = await Promise.all([
    admin
      .from("colony_transports")
      .select("colony_id, tier")
      .in("colony_id", colonyIds),
    admin
      .from("resource_inventory")
      .select("location_id, resource_type, quantity")
      .eq("location_type", "colony")
      .in("location_id", colonyIds),
  ]);

  // Build transport capacity map: colony_id → total capacity
  const transportCapacity = new Map<string, number>();
  for (const t of (transportsRes.data ?? []) as TransportRow[]) {
    const cap = BALANCE.colonyTransport.capacityPerTier[t.tier] ?? 0;
    transportCapacity.set(t.colony_id, (transportCapacity.get(t.colony_id) ?? 0) + cap);
  }

  // Build mutable inventory map: `${colonyId}:${resource_type}` → quantity
  const inventory = new Map<string, number>();
  for (const row of (inventoryRes.data ?? []) as InventoryRow[]) {
    inventory.set(`${row.location_id}:${row.resource_type}`, row.quantity);
  }

  const result: RouteResolutionResult = { routesRun: 0, transfersMade: 0, totalUnitsTransferred: 0 };

  // Track which (colonyId, resource) pairs need to be written back
  const dirtyKeys = new Set<string>();

  for (const route of dueRoutes) {
    result.routesRun++;

    const capacity = transportCapacity.get(route.from_colony_id) ?? 0;
    if (capacity === 0) continue; // no transport units — skip transfer, still advance timer

    const invKey = `${route.from_colony_id}:${route.resource_type}`;
    const available = inventory.get(invKey) ?? 0;
    if (available === 0) continue;

    let transferQty = 0;
    switch (route.mode) {
      case "all":
        transferQty = Math.min(available, capacity);
        break;
      case "excess": {
        const excess = Math.max(0, available - BALANCE.colonyTransport.excessThreshold);
        transferQty = Math.min(excess, capacity);
        break;
      }
      case "fixed":
        transferQty = Math.min(route.fixed_amount ?? 0, available, capacity);
        break;
    }

    if (transferQty <= 0) continue;

    // Apply transfer to in-memory inventory
    const fromKey = `${route.from_colony_id}:${route.resource_type}`;
    const toKey   = `${route.to_colony_id}:${route.resource_type}`;
    inventory.set(fromKey, (inventory.get(fromKey) ?? 0) - transferQty);
    inventory.set(toKey,   (inventory.get(toKey)   ?? 0) + transferQty);
    dirtyKeys.add(fromKey);
    dirtyKeys.add(toKey);

    result.transfersMade++;
    result.totalUnitsTransferred += transferQty;
  }

  // Persist all dirty inventory rows + advance all due route timers in parallel
  const upsertRows = [...dirtyKeys].map((key) => {
    const [locationId, resourceType] = key.split(/:(.+)/); // split on first colon only
    return {
      location_type: "colony",
      location_id:   locationId,
      resource_type: resourceType,
      quantity:      Math.max(0, inventory.get(key) ?? 0),
    };
  });

  const routeUpdates = dueRoutes.map((r) =>
    admin.from("colony_routes").update({ last_run_at: nowIso }).eq("id", r.id),
  );

  await Promise.all([
    upsertRows.length > 0
      ? admin.from("resource_inventory").upsert(upsertRows, { onConflict: "location_type,location_id,resource_type" })
      : Promise.resolve(),
    ...routeUpdates,
  ]);

  return result;
}
