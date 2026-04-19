/**
 * POST /api/game/governance/contest
 *
 * Any player can trigger a re-check of the current majority controller's
 * influence in a system. Typical callers: the steward who lost governance,
 * or a rival who has grown their influence since the last claim.
 *
 * Steps:
 *   1. Fetch the current majority control record.
 *   2. Refresh the influence cache.
 *   3. Recompute the controller's current influence share:
 *        - Individual player: their share directly.
 *        - Alliance block: sum of all member shares.
 *   4. If share dropped to ≤ 50%: set is_confirmed = false.
 *      If share recovered to > 50%: restore is_confirmed = true.
 *   5. The checkContestedRevert lazy function (called on each page load)
 *      handles actual governance revert after contestedRevertHours.
 *
 * Body: { systemId: string }
 * Returns: { ok: true, data: { hasMajorityControl, stillConfirmed, influenceShare } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshInfluenceCache } from "@/lib/game/influence";

const Schema = z.object({
  systemId: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { systemId } = input.data as { systemId: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Current majority control record ──────────────────────────────────────
  const { data: mcRaw } = await admin
    .from("system_majority_control")
    .select("id, controller_id, alliance_id, influence_share, is_confirmed")
    .eq("system_id", systemId)
    .maybeSingle();

  if (!mcRaw) {
    return Response.json({ ok: true, data: { hasMajorityControl: false } });
  }

  const mc = mcRaw as {
    id: string;
    controller_id: string;
    alliance_id: string | null;
    influence_share: number;
    is_confirmed: boolean;
  };

  // ── Refresh influence cache ───────────────────────────────────────────────
  const snapshots = await refreshInfluenceCache(admin, systemId);

  const total = snapshots.reduce((s, e) => s + e.influence, 0);
  let currentShare = 0;

  if (total > 0) {
    if (mc.alliance_id) {
      // Alliance majority: fetch member IDs, sum their influence.
      const { data: memberRows } = await admin
        .from("alliance_members")
        .select("player_id")
        .eq("alliance_id", mc.alliance_id);
      const memberIds = new Set(
        ((memberRows ?? []) as { player_id: string }[]).map((r) => r.player_id),
      );
      const allianceInfluence = snapshots
        .filter((s) => memberIds.has(s.playerId))
        .reduce((sum, s) => sum + s.influence, 0);
      currentShare = allianceInfluence / total;
    } else {
      const controllerSnap = snapshots.find((s) => s.playerId === mc.controller_id);
      currentShare = (controllerSnap?.influence ?? 0) / total;
    }
  }

  const stillMajority = currentShare > 0.5;

  if (!stillMajority && mc.is_confirmed) {
    // Controller fell below threshold — mark as contested.
    await admin
      .from("system_majority_control")
      .update({ is_confirmed: false, influence_share: currentShare })
      .eq("system_id", systemId);
  } else if (stillMajority && !mc.is_confirmed) {
    // Controller recovered — restore confirmation.
    await admin
      .from("system_majority_control")
      .update({ is_confirmed: true, influence_share: currentShare })
      .eq("system_id", systemId);
  } else if (stillMajority) {
    // Update the stored share to the current value.
    await admin
      .from("system_majority_control")
      .update({ influence_share: currentShare })
      .eq("system_id", systemId);
  }

  return Response.json({
    ok: true,
    data: {
      hasMajorityControl: true,
      stillConfirmed:     stillMajority,
      influenceShare:     currentShare,
    },
  });
}
