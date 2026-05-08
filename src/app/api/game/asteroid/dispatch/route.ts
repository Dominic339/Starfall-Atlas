/**
 * POST /api/game/asteroid/dispatch
 *
 * Dispatches a player-owned fleet to harvest an asteroid node.
 *
 * Validation:
 *   1. Authenticated player.
 *   2. Asteroid exists and is active (remaining_amount > 0).
 *   3. Player owns the specified fleet.
 *   4. Fleet is not disbanded and has no active harvest already.
 *   5. Fleet is currently located at the asteroid's associated system.
 *      (Fleet must be in-system — no travel to asteroid required for alpha.)
 *
 * On success:
 *   - Inserts an asteroid_harvests row with harvest_power_per_hr computed from
 *     the fleet's total ship turret levels at this moment.
 *
 * Body:   { asteroidId: string, fleetId: string }
 * Returns: { ok: true, data: { harvest: AsteroidHarvest } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeHarvestPower } from "@/lib/game/asteroids";
import { getBalanceWithOverrides } from "@/lib/config/balanceOverrides";
import { getActiveLiveEvents, harvestBoostMultiplier } from "@/lib/game/liveEvents";
import { fleetFormationHarvestMultiplier } from "@/lib/game/researchHelpers";
import type { AsteroidHarvest } from "@/lib/types/game";

const DispatchSchema = z.object({
  asteroidId: z.string().uuid(),
  fleetId:    z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(DispatchSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { asteroidId, fleetId } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const [balance, liveEvents, researchRes] = await Promise.all([
    getBalanceWithOverrides(admin),
    getActiveLiveEvents(admin),
    admin.from("player_research").select("research_id").eq("player_id", player.id),
  ]);

  // ── Fetch asteroid (both tables), fleet, and existing harvest in parallel ──
  type AsteroidRow = { id: string; system_id: string; resource_type: string; remaining_amount: number; status: string };
  const [regRes, evRes, fleetRes, existingHarvestRes] = await Promise.all([
    admin.from("asteroid_nodes").select("id, system_id, resource_type, remaining_amount, status").eq("id", asteroidId).maybeSingle(),
    admin.from("live_event_nodes").select("id, system_id, resource_type, remaining_amount, status").eq("id", asteroidId).maybeSingle(),
    admin.from("fleets").select("id, player_id, current_system_id, status").eq("id", fleetId).maybeSingle(),
    admin.from("asteroid_harvests").select("id, asteroid_id").eq("fleet_id", fleetId).eq("status", "active").maybeSingle(),
  ]);

  const asteroid = (regRes.data ?? evRes.data ?? null) as AsteroidRow | null;
  if (!asteroid) return toErrorResponse(fail("not_found", "Asteroid node not found.").error);
  if (asteroid.status !== "active" || asteroid.remaining_amount <= 0) {
    return toErrorResponse(fail("invalid_target", "This asteroid has already been depleted.").error);
  }

  const fleet = fleetRes.data as { id: string; player_id: string; current_system_id: string | null; status: string } | null;
  if (!fleet) return toErrorResponse(fail("not_found", "Fleet not found.").error);
  if (fleet.player_id !== player.id) return toErrorResponse(fail("forbidden", "You do not own this fleet.").error);
  if (fleet.status === "disbanded") return toErrorResponse(fail("invalid_target", "This fleet has been disbanded.").error);
  if (fleet.current_system_id !== asteroid.system_id) {
    return toErrorResponse(fail("invalid_target", `Fleet must be in ${asteroid.system_id} to harvest this asteroid (currently in ${fleet.current_system_id ?? "transit"}).`).error);
  }

  const existingHarvest = existingHarvestRes.data as { id: string; asteroid_id: string } | null;

  if (existingHarvest) {
    if (existingHarvest.asteroid_id === asteroidId) {
      return toErrorResponse(
        fail("invalid_target", "This fleet is already harvesting this asteroid.").error,
      );
    }
    return toErrorResponse(
      fail("invalid_target", "This fleet is already assigned to another asteroid. Recall it first.").error,
    );
  }

  // ── Compute harvesting power from fleet's ships ───────────────────────────
  const { data: fleetShips } = await admin
    .from("fleet_ships")
    .select("ship_id")
    .eq("fleet_id", fleetId);

  const shipIds = (fleetShips ?? []).map((fs: { ship_id: string }) => fs.ship_id);

  let totalTurretLevel = 0;
  if (shipIds.length > 0) {
    const { data: ships } = await admin
      .from("ships")
      .select("turret_level")
      .in("id", shipIds);
    totalTurretLevel = (ships ?? []).reduce(
      (sum: number, s: { turret_level: number }) => sum + (s.turret_level ?? 0),
      0,
    );
  }

  const unlockedResearchIds = new Set(
    ((researchRes?.data ?? []) as { research_id: string }[]).map((r) => r.research_id),
  );
  const basePower = computeHarvestPower(totalTurretLevel, balance);
  const eventMult = harvestBoostMultiplier(liveEvents, asteroid.system_id);
  const formationMult = fleetFormationHarvestMultiplier(unlockedResearchIds, balance);
  const harvestPowerPerHr = basePower * eventMult * formationMult;

  // ── Insert harvest record ────────────────────────────────────────────────
  const now = new Date().toISOString();
  const { data: harvest } = await admin
    .from("asteroid_harvests")
    .insert({
      asteroid_id:          asteroidId,
      fleet_id:             fleetId,
      player_id:            player.id,
      harvest_power_per_hr: harvestPowerPerHr,
      status:               "active",
      started_at:           now,
      last_resolved_at:     now,
    })
    .select("*")
    .maybeSingle();

  if (!harvest) {
    return Response.json(
      { ok: false, error: { code: "internal_error", message: "Failed to create harvest record." } },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, data: { harvest: harvest as AsteroidHarvest } });
}
