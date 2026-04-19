/**
 * POST /api/game/governance/claim-majority
 *
 * A player (or an alliance acting through one of its members) asserts majority
 * control over a system when they hold >50% of system influence with ≥3 active
 * colonies.
 *
 * Steps:
 *   1. Refresh the influence cache for the system from live colony/structure data.
 *   2. Run detectMajority — checks individual-player threshold first, then
 *      alliance-aggregate threshold.
 *   3. Verify the caller is the detected majority controller (or is in the
 *      majority alliance).
 *   4. Upsert system_majority_control.
 *   5. If the steward currently holds governance, transfer it:
 *        - system_stewardship.has_governance → false
 *        - Neutralize any active gate
 *        - Log majority_control_gained + gate_neutralized world events
 *
 * Body: { systemId: string }
 * Returns: { ok: true, data: { influenceShare, allianceId, governanceTransferred } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { refreshInfluenceCache, detectMajority } from "@/lib/game/influence";

const Schema = z.object({
  systemId: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { systemId } = input.data as { systemId: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── System must have a stewardship record ────────────────────────────────
  const { data: stewardRow } = maybeSingleResult<{ steward_id: string; has_governance: boolean }>(
    await admin
      .from("system_stewardship")
      .select("steward_id, has_governance")
      .eq("system_id", systemId)
      .maybeSingle(),
  );

  if (!stewardRow) {
    return toErrorResponse(
      fail("not_found", "This system has no governance record. It must be discovered first.").error,
    );
  }

  // ── Player alliance membership ───────────────────────────────────────────
  const { data: memberRow } = await admin
    .from("alliance_members")
    .select("alliance_id")
    .eq("player_id", player.id)
    .maybeSingle();
  const playerAllianceId = (memberRow as { alliance_id: string } | null)?.alliance_id ?? null;

  // ── Refresh influence cache ───────────────────────────────────────────────
  const snapshots = await refreshInfluenceCache(admin, systemId);

  // Build alliance membership map if player is in an alliance.
  let allianceMembership: Map<string, string> | undefined;
  if (playerAllianceId && snapshots.length > 0) {
    const playerIds = snapshots.map((s) => s.playerId);
    const { data: memberRows } = await admin
      .from("alliance_members")
      .select("player_id, alliance_id")
      .in("player_id", playerIds);
    allianceMembership = new Map(
      ((memberRows ?? []) as { player_id: string; alliance_id: string }[]).map(
        (r) => [r.player_id, r.alliance_id],
      ),
    );
  }

  // ── Majority threshold check ─────────────────────────────────────────────
  const majority = detectMajority(snapshots, allianceMembership);

  if (!majority) {
    return toErrorResponse(
      fail(
        "threshold_not_met",
        "Majority threshold not met. You need >50% of system influence and at least 3 active colonies.",
      ).error,
    );
  }

  // Verify the caller is (or is in) the detected majority block.
  const isCallerMajority =
    majority.controllerId === player.id ||
    (majority.allianceId !== null && majority.allianceId === playerAllianceId);

  if (!isCallerMajority) {
    return toErrorResponse(
      fail("forbidden", "Another player or alliance holds majority control in this system.").error,
    );
  }

  // ── Upsert majority control ──────────────────────────────────────────────
  const now = new Date().toISOString();
  await admin.from("system_majority_control").upsert(
    {
      system_id:       systemId,
      controller_id:   player.id,
      alliance_id:     majority.allianceId,
      influence_share: majority.influenceShare,
      is_confirmed:    true,
      control_since:   now,
    },
    { onConflict: "system_id" },
  );

  // ── Governance transfer (if steward currently holds it) ──────────────────
  const governanceTransferred = stewardRow.has_governance;
  if (governanceTransferred) {
    await admin
      .from("system_stewardship")
      .update({ has_governance: false })
      .eq("system_id", systemId);

    // Neutralize the active gate (if any).
    const { data: gateRow } = await admin
      .from("hyperspace_gates")
      .select("id")
      .eq("system_id", systemId)
      .eq("status", "active")
      .maybeSingle();

    if (gateRow) {
      await admin
        .from("hyperspace_gates")
        .update({ status: "neutral", neutralized_at: now })
        .eq("id", (gateRow as { id: string }).id);

      await admin.from("world_events").insert({
        event_type: "gate_neutralized",
        player_id:  player.id,
        system_id:  systemId,
        metadata:   { reason: "majority_control_transfer" },
      });
    }

    await admin.from("world_events").insert({
      event_type: "majority_control_gained",
      player_id:  player.id,
      system_id:  systemId,
      metadata: {
        influence_share: majority.influenceShare,
        alliance_id:     majority.allianceId,
      },
    });
  }

  return Response.json({
    ok: true,
    data: {
      influenceShare:       majority.influenceShare,
      allianceId:           majority.allianceId,
      governanceTransferred,
      systemId,
    },
  });
}
