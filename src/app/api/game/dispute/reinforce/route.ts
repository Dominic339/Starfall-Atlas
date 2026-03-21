/**
 * POST /api/game/dispute/reinforce
 *
 * Commits a player's fleet to an active dispute, locking it until resolution.
 *
 * Validation:
 *   1. Caller is authenticated and in an alliance.
 *   2. The dispute exists and is 'open'.
 *   3. Caller's alliance is the defender or attacker.
 *   4. Fleet exists, is owned by caller, status='active', not already committed.
 *   5. Fleet's current system is known (not traveling).
 *   6. Fleet's ETA to the beacon system is ≤ resolves_at (travel time check).
 *
 * On success:
 *   - Snapshot fleet score (frozen at commit time).
 *   - Insert dispute_reinforcement row.
 *   - Set fleet.dispute_commit_id = disputeId (locks the fleet).
 *
 * Body:   { disputeId: string, fleetId: string }
 * Returns: { ok: true, data: { reinforcementId, scoreSnapshot } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult, maybeSingleResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { distanceBetween, computeArrivalTime } from "@/lib/game/travel";
import { computeFleetDisputeScore } from "@/lib/game/disputeScore";
import { resolveOverdueDisputes } from "@/lib/game/disputeResolution";
import type { Fleet, FleetShip, Ship } from "@/lib/types/game";

const ReinforceSchema = z.object({
  disputeId: z.string().uuid(),
  fleetId:   z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ─────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(ReinforceSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { disputeId, fleetId } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Lazy resolution pass ──────────────────────────────────────────────────
  await resolveOverdueDisputes(admin);

  // ── Caller must be in an alliance ─────────────────────────────────────────
  type MemberRow = { alliance_id: string };
  const { data: membership } = maybeSingleResult<MemberRow>(
    await admin
      .from("alliance_members")
      .select("alliance_id")
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  if (!membership) {
    return toErrorResponse(fail("forbidden", "You are not in an alliance.").error);
  }
  const callerAllianceId = membership.alliance_id;

  // ── Fetch dispute ─────────────────────────────────────────────────────────
  type DisputeRow = {
    id: string;
    beacon_id: string;
    defending_alliance_id: string;
    attacking_alliance_id: string;
    status: string;
    resolves_at: string;
  };
  const { data: dispute } = maybeSingleResult<DisputeRow>(
    await admin
      .from("disputes")
      .select("id, beacon_id, defending_alliance_id, attacking_alliance_id, status, resolves_at")
      .eq("id", disputeId)
      .maybeSingle(),
  );

  if (!dispute) {
    return toErrorResponse(fail("not_found", "Dispute not found.").error);
  }
  if (dispute.status !== "open") {
    return toErrorResponse(fail("already_exists", "This dispute is no longer active.").error);
  }

  // ── Caller's alliance must be a party to the dispute ─────────────────────
  if (
    callerAllianceId !== dispute.defending_alliance_id &&
    callerAllianceId !== dispute.attacking_alliance_id
  ) {
    return toErrorResponse(
      fail("forbidden", "Your alliance is not a party to this dispute.").error,
    );
  }

  // ── Fetch fleet ───────────────────────────────────────────────────────────
  const { data: fleet } = maybeSingleResult<Fleet>(
    await admin
      .from("fleets")
      .select("*")
      .eq("id", fleetId)
      .maybeSingle(),
  );

  if (!fleet) {
    return toErrorResponse(fail("not_found", "Fleet not found.").error);
  }
  if (fleet.player_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You do not own this fleet.").error);
  }
  if (fleet.status !== "active") {
    return toErrorResponse(
      fail(
        "job_in_progress",
        fleet.status === "traveling"
          ? "Fleet is currently traveling and cannot be committed."
          : "Fleet has been disbanded.",
      ).error,
    );
  }
  if (fleet.dispute_commit_id) {
    return toErrorResponse(
      fail("already_exists", "Fleet is already committed to a dispute.").error,
    );
  }

  const fromSystemId = fleet.current_system_id;
  if (!fromSystemId) {
    return toErrorResponse(
      fail("invalid_target", "Fleet has no current system.").error,
    );
  }

  // ── Fetch beacon system for ETA calculation ───────────────────────────────
  type BeaconRow = { system_id: string };
  const { data: beacon } = maybeSingleResult<BeaconRow>(
    await admin
      .from("alliance_beacons")
      .select("system_id")
      .eq("id", dispute.beacon_id)
      .maybeSingle(),
  );

  if (!beacon) {
    return toErrorResponse(fail("not_found", "Dispute beacon not found.").error);
  }

  const beaconSystemId = beacon.system_id;

  // ── ETA check ─────────────────────────────────────────────────────────────
  const now = new Date();
  const resolvesAt = new Date(dispute.resolves_at);

  // If the fleet is already at the beacon system, ETA is now (always valid)
  let eta = now;
  if (fromSystemId !== beaconSystemId) {
    const fromEntry = getCatalogEntry(fromSystemId);
    const destEntry = getCatalogEntry(beaconSystemId);

    if (!fromEntry || !destEntry) {
      return toErrorResponse(
        fail("not_found", "Could not compute travel distance (catalog entry missing).").error,
      );
    }

    // Fetch member ships to get fleet speed
    const { data: fleetShipRows } = listResult<FleetShip>(
      await admin
        .from("fleet_ships")
        .select("ship_id")
        .eq("fleet_id", fleetId),
    );

    const memberShipIds = (fleetShipRows ?? []).map((r) => r.ship_id);
    if (memberShipIds.length === 0) {
      return toErrorResponse(
        fail("invalid_target", "Fleet has no member ships.").error,
      );
    }

    const { data: memberShips } = listResult<Pick<Ship, "id" | "speed_ly_per_hr">>(
      await admin
        .from("ships")
        .select("id, speed_ly_per_hr")
        .in("id", memberShipIds),
    );

    const ships = memberShips ?? [];
    if (ships.length === 0) {
      return toErrorResponse(
        fail("invalid_target", "Fleet has no member ships.").error,
      );
    }

    const fleetSpeed = Math.min(...ships.map((s) => s.speed_ly_per_hr));
    const distanceLy = distanceBetween(
      { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
      { x: destEntry.x, y: destEntry.y, z: destEntry.z },
    );

    eta = computeArrivalTime(now, distanceLy, fleetSpeed);
  }

  if (eta > resolvesAt) {
    const hoursLeft = ((resolvesAt.getTime() - now.getTime()) / (1000 * 60 * 60)).toFixed(1);
    return toErrorResponse(
      fail(
        "invalid_target",
        `Fleet would arrive too late. Dispute ends in ~${hoursLeft}h but your fleet cannot arrive in time.`,
      ).error,
    );
  }

  // ── Snapshot score from fleet ships ───────────────────────────────────────
  const { data: fleetShipRowsFinal } = listResult<FleetShip>(
    await admin
      .from("fleet_ships")
      .select("ship_id")
      .eq("fleet_id", fleetId),
  );

  const finalShipIds = (fleetShipRowsFinal ?? []).map((r) => r.ship_id);

  type ShipStatRow = { turret_level: number; hull_level: number; shield_level: number };
  let scoreSnapshot = 0;
  if (finalShipIds.length > 0) {
    const { data: statRows } = listResult<ShipStatRow>(
      await admin
        .from("ships")
        .select("turret_level, hull_level, shield_level")
        .in("id", finalShipIds),
    );
    scoreSnapshot = computeFleetDisputeScore(statRows ?? []);
  }

  // ── Insert reinforcement and lock fleet (atomic-ish) ─────────────────────
  type NewReinforceRow = { id: string };
  const { data: newReinforce } = maybeSingleResult<NewReinforceRow>(
    await admin
      .from("dispute_reinforcements")
      .insert({
        dispute_id:     disputeId,
        alliance_id:    callerAllianceId,
        fleet_id:       fleetId,
        player_id:      player.id,
        score_snapshot: scoreSnapshot,
        committed_at:   now.toISOString(),
        is_active:      true,
      })
      .select("id")
      .single(),
  );

  if (!newReinforce) {
    return toErrorResponse(fail("internal_error", "Failed to commit fleet.").error);
  }

  // Lock the fleet
  await admin
    .from("fleets")
    .update({ dispute_commit_id: disputeId })
    .eq("id", fleetId);

  return Response.json({
    ok: true,
    data: {
      reinforcementId: newReinforce.id,
      scoreSnapshot,
    },
  });
}
