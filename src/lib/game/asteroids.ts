/**
 * Asteroid harvest logic — Phase 20.
 *
 * Harvesting power formula and lazy shared-depletion resolution.
 *
 * Design:
 *   - Harvest power is based on total turret_level across all ships in a fleet.
 *   - Lazy resolution: elapsed hours × power = units harvested this session.
 *   - Capped by BALANCE.asteroids.maxHarvestAccumulationHours to prevent abuse.
 *   - Resources deposited into player station inventory; remaining_amount decremented.
 *   - When remaining_amount hits 0 the asteroid status is set to 'depleted'.
 */

import { BALANCE } from "@/lib/config/balance";
import type { BalanceConfig } from "@/lib/config/balanceOverrides";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Power formula
// ---------------------------------------------------------------------------

/**
 * Compute harvesting power (units/hr) for a fleet given the sum of turret
 * levels across all ships in that fleet.
 *
 * Formula: base + totalTurretLevel × ratePerLevel
 */
export function computeHarvestPower(totalTurretLevel: number, balance: BalanceConfig = BALANCE): number {
  return (
    balance.asteroids.baseHarvestUnitsPerHr +
    totalTurretLevel * balance.asteroids.harvestUnitsPerHrPerTurretLevel
  );
}

// ---------------------------------------------------------------------------
// Lazy resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all active harvests for a single asteroid node.
 *
 * Called during galaxy-map page load for any asteroid that has active harvests.
 * Idempotent within the accumulation cap window — repeated calls simply
 * re-apply elapsed time since last_resolved_at.
 *
 * Steps:
 *   1. Fetch current remaining_amount.
 *   2. For each active harvest, compute units earned since last_resolved_at.
 *   3. Clamp total harvested to remaining_amount.
 *   4. Credit resources to each player's station inventory (pro-rata split).
 *   5. Update remaining_amount on asteroid_nodes.
 *   6. Update last_resolved_at on each harvest.
 *   7. Mark asteroid depleted / harvests completed if remaining hits 0.
 *
 * All writes are performed with the admin client so RLS is bypassed for the
 * shared asteroid_nodes table.
 *
 * @returns Updated remaining_amount after resolution.
 */
export async function resolveAsteroidHarvests(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>,
  asteroidId: string,
  balance: BalanceConfig = BALANCE,
): Promise<number> {
  const now = new Date();

  // ── Fetch asteroid (regular nodes OR live event nodes) ───────────────────
  let isEventNode = false;
  let { data: asteroid } = await admin
    .from("asteroid_nodes")
    .select("id, resource_type, remaining_amount, status, last_resolved_at")
    .eq("id", asteroidId)
    .maybeSingle();

  if (!asteroid) {
    const { data: ev } = await admin
      .from("live_event_nodes")
      .select("id, resource_type, remaining_amount, status, spawned_at")
      .eq("id", asteroidId)
      .maybeSingle();
    if (ev) {
      isEventNode = true;
      asteroid = { ...ev, last_resolved_at: ev.spawned_at };
    }
  }

  if (!asteroid || asteroid.status !== "active" || asteroid.remaining_amount <= 0) {
    return asteroid?.remaining_amount ?? 0;
  }

  // ── Fetch active harvests ─────────────────────────────────────────────────
  const { data: harvests } = await admin
    .from("asteroid_harvests")
    .select("id, player_id, harvest_power_per_hr, last_resolved_at")
    .eq("asteroid_id", asteroidId)
    .eq("status", "active");

  if (!harvests || harvests.length === 0) {
    return asteroid.remaining_amount;
  }

  // ── Compute each harvest's contribution ───────────────────────────────────
  const cap = balance.asteroids.maxHarvestAccumulationHours;

  type HarvestEntry = {
    id: string;
    player_id: string;
    harvest_power_per_hr: number;
    last_resolved_at: string;
    earned: number; // computed below
  };

  const entries: HarvestEntry[] = harvests.map(
    (h: { id: string; player_id: string; harvest_power_per_hr: number; last_resolved_at: string }) => {
      const elapsedMs = now.getTime() - new Date(h.last_resolved_at).getTime();
      const elapsedHours = Math.min(elapsedMs / 3_600_000, cap);
      const earned = Math.floor(h.harvest_power_per_hr * elapsedHours);
      return { ...h, earned };
    },
  );

  const totalEarned = entries.reduce((s, e) => s + e.earned, 0);
  if (totalEarned === 0) {
    return asteroid.remaining_amount;
  }

  // ── Clamp to remaining ────────────────────────────────────────────────────
  const available = asteroid.remaining_amount;
  const actualTotal = Math.min(totalEarned, available);

  // Pro-rata share per player (some fleets may earn 0 after clamp)
  const scale = actualTotal / totalEarned; // ≤ 1.0

  // ── Group by player_id (a player could theoretically have multiple fleets) ─
  const playerCredits = new Map<string, number>();
  for (const e of entries) {
    const share = Math.floor(e.earned * scale);
    playerCredits.set(e.player_id, (playerCredits.get(e.player_id) ?? 0) + share);
  }

  // Account for rounding: give leftover to the first player
  const sumShares = Array.from(playerCredits.values()).reduce((s, v) => s + v, 0);
  const leftover = actualTotal - sumShares;
  if (leftover > 0 && playerCredits.size > 0) {
    const firstKey = playerCredits.keys().next().value!;
    playerCredits.set(firstKey, playerCredits.get(firstKey)! + leftover);
  }

  // ── Fetch station IDs for each player ────────────────────────────────────
  const playerIds = Array.from(playerCredits.keys());
  const { data: stations } = await admin
    .from("stations")
    .select("id, player_id")
    .in("player_id", playerIds);

  const stationByPlayer = new Map<string, string>(
    (stations ?? []).map((s: { id: string; player_id: string }) => [s.player_id, s.id]),
  );

  // ── Credit resources into station inventory ───────────────────────────────
  for (const [playerId, units] of playerCredits.entries()) {
    if (units <= 0) continue;
    const stationId = stationByPlayer.get(playerId);
    if (!stationId) continue;

    // Upsert into resource_inventory
    const { data: existing } = await admin
      .from("resource_inventory")
      .select("id, quantity")
      .eq("location_id", stationId)
      .eq("location_type", "station")
      .eq("resource_type", asteroid.resource_type)
      .maybeSingle();

    if (existing) {
      await admin
        .from("resource_inventory")
        .update({ quantity: existing.quantity + units })
        .eq("id", existing.id);
    } else {
      await admin
        .from("resource_inventory")
        .insert({
          location_id: stationId,
          location_type: "station",
          resource_type: asteroid.resource_type,
          quantity: units,
        });
    }
  }

  // ── Update harvest last_resolved_at ───────────────────────────────────────
  const harvestIds = entries.map((e) => e.id);
  await admin
    .from("asteroid_harvests")
    .update({ last_resolved_at: now.toISOString() })
    .in("id", harvestIds);

  // ── Update asteroid remaining_amount ──────────────────────────────────────
  const newRemaining = available - actualTotal;
  const nowDepleted = newRemaining <= 0;
  const nodeTable = isEventNode ? "live_event_nodes" : "asteroid_nodes";

  await admin
    .from(nodeTable)
    .update({
      remaining_amount: newRemaining,
      last_resolved_at: now.toISOString(),
      ...(nowDepleted ? { status: "depleted" } : {}),
    })
    .eq("id", asteroidId);

  // ── Mark harvests completed if depleted ───────────────────────────────────
  if (nowDepleted) {
    await admin
      .from("asteroid_harvests")
      .update({ status: "completed" })
      .in("id", harvestIds)
      .eq("status", "active");
  }

  return newRemaining;
}
