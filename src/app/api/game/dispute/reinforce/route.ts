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

  // ── Batch 1: membership + dispute + fleet + fleet members in parallel ──────
  type MemberRow = { alliance_id: string };
  type DisputeRow = { id: string; beacon_id: string; defending_alliance_id: string; attacking_alliance_id: string; status: string; resolves_at: string };
  const [membershipRes, disputeRes, fleetRes, fleetShipRes] = await Promise.all([
    admin.from("alliance_members").select("alliance_id").eq("player_id", player.id).maybeSingle(),
    admin.from("disputes").select("id, beacon_id, defending_alliance_id, attacking_alliance_id, status, resolves_at").eq("id", disputeId).maybeSingle(),
    admin.from("fleets").select("*").eq("id", fleetId).maybeSingle(),
    admin.from("fleet_ships").select("ship_id").eq("fleet_id", fleetId),
  ]);

  const { data: membership } = maybeSingleResult<MemberRow>(membershipRes);
  if (!membership) return toErrorResponse(fail("forbidden", "You are not in an alliance.").error);
  const callerAllianceId = membership.alliance_id;

  const { data: dispute } = maybeSingleResult<DisputeRow>(disputeRes);
  if (!dispute) return toErrorResponse(fail("not_found", "Dispute not found.").error);
  if (dispute.status !== "open") return toErrorResponse(fail("already_exists", "This dispute is no longer active.").error);
  if (callerAllianceId !== dispute.defending_alliance_id && callerAllianceId !== dispute.attacking_alliance_id) {
    return toErrorResponse(fail("forbidden", "Your alliance is not a party to this dispute.").error);
  }

  const { data: fleet } = maybeSingleResult<Fleet>(fleetRes);
  if (!fleet) return toErrorResponse(fail("not_found", "Fleet not found.").error);
  if (fleet.player_id !== player.id) return toErrorResponse(fail("forbidden", "You do not own this fleet.").error);
  if (fleet.status !== "active") {
    return toErrorResponse(
      fail("job_in_progress", fleet.status === "traveling" ? "Fleet is currently traveling and cannot be committed." : "Fleet has been disbanded.").error,
    );
  }
  if (fleet.dispute_commit_id) return toErrorResponse(fail("already_exists", "Fleet is already committed to a dispute.").error);

  const fromSystemId = fleet.current_system_id;
  if (!fromSystemId) return toErrorResponse(fail("invalid_target", "Fleet has no current system.").error);

  const { data: fleetShipRows } = listResult<FleetShip>(fleetShipRes);
  const memberShipIds = (fleetShipRows ?? []).map((r) => r.ship_id);
  if (memberShipIds.length === 0) return toErrorResponse(fail("invalid_target", "Fleet has no member ships.").error);

  // ── Batch 2: beacon + member ships (with all needed columns) in parallel ──
  type BeaconRow = { system_id: string };
  type ShipStatRow = { id: string; speed_ly_per_hr: number; turret_level: number; hull_level: number; shield_level: number };
  const [beaconRes, memberShipsRes] = await Promise.all([
    admin.from("alliance_beacons").select("system_id").eq("id", dispute.beacon_id).maybeSingle(),
    admin.from("ships").select("id, speed_ly_per_hr, turret_level, hull_level, shield_level").in("id", memberShipIds),
  ]);

  const { data: beacon } = maybeSingleResult<BeaconRow>(beaconRes);
  if (!beacon) return toErrorResponse(fail("not_found", "Dispute beacon not found.").error);
  const beaconSystemId = beacon.system_id;

  const memberShips = listResult<ShipStatRow>(memberShipsRes).data ?? [];
  if (memberShips.length === 0) return toErrorResponse(fail("invalid_target", "Fleet has no member ships.").error);

  // ── ETA check ─────────────────────────────────────────────────────────────
  const now = new Date();
  const resolvesAt = new Date(dispute.resolves_at);
  let eta = now;
  if (fromSystemId !== beaconSystemId) {
    const fromEntry = getCatalogEntry(fromSystemId);
    const destEntry = getCatalogEntry(beaconSystemId);
    if (!fromEntry || !destEntry) {
      return toErrorResponse(fail("not_found", "Could not compute travel distance (catalog entry missing).").error);
    }
    const fleetSpeed = Math.min(...memberShips.map((s) => s.speed_ly_per_hr));
    const distanceLy = distanceBetween(
      { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
      { x: destEntry.x, y: destEntry.y, z: destEntry.z },
    );
    eta = computeArrivalTime(now, distanceLy, fleetSpeed);
  }

  if (eta > resolvesAt) {
    const hoursLeft = ((resolvesAt.getTime() - now.getTime()) / (1000 * 60 * 60)).toFixed(1);
    return toErrorResponse(
      fail("invalid_target", `Fleet would arrive too late. Dispute ends in ~${hoursLeft}h but your fleet cannot arrive in time.`).error,
    );
  }

  // ── Snapshot score ─────────────────────────────────────────────────────────
  const scoreSnapshot = computeFleetDisputeScore(memberShips);

  // ── Insert reinforcement and lock fleet in parallel ───────────────────────
  type NewReinforceRow = { id: string };
  const [reinforceRes] = await Promise.all([
    admin.from("dispute_reinforcements").insert({
      dispute_id:     disputeId,
      alliance_id:    callerAllianceId,
      fleet_id:       fleetId,
      player_id:      player.id,
      score_snapshot: scoreSnapshot,
      committed_at:   now.toISOString(),
      is_active:      true,
    }).select("id").single(),
    admin.from("fleets").update({ dispute_commit_id: disputeId }).eq("id", fleetId),
  ]);

  const { data: newReinforce } = maybeSingleResult<NewReinforceRow>(reinforceRes);
  if (!newReinforce) {
    return toErrorResponse(fail("internal_error", "Failed to commit fleet.").error);
  }

  return Response.json({
    ok: true,
    data: {
      reinforcementId: newReinforce.id,
      scoreSnapshot,
    },
  });
}
