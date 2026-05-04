/**
 * POST /api/game/alliance/join
 *
 * Joins an alliance using its invite code.
 *
 * Validation:
 *   1. Auth
 *   2. Input: inviteCode (string)
 *   3. Player is not already in an alliance
 *   4. Alliance with that invite code exists and is not dissolved
 *
 * Inserts an alliance_members row (role = 'member') and increments member_count.
 *
 * Body:   { inviteCode: string }
 * Returns: { ok: true, data: { allianceId, name, tag } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import type { Alliance } from "@/lib/types/game";

const JoinAllianceSchema = z.object({
  inviteCode: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(JoinAllianceSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { inviteCode } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Validate membership + alliance in parallel ────────────────────────────
  const [existingMembershipRes, allianceRes] = await Promise.all([
    admin.from("alliance_members").select("id").eq("player_id", player.id).maybeSingle(),
    admin.from("alliances").select("id, name, tag, member_count, dissolved_at").eq("invite_code", inviteCode.toLowerCase()).maybeSingle(),
  ]);

  const { data: existingMembership } = maybeSingleResult<{ id: string }>(existingMembershipRes);
  if (existingMembership) {
    return toErrorResponse(fail("invalid_target", "You are already in an alliance. Leave it first.").error);
  }

  const { data: alliance } = maybeSingleResult<Alliance>(allianceRes);
  if (!alliance) {
    return toErrorResponse(fail("not_found", "No alliance found with that invite code.").error);
  }
  if (alliance.dissolved_at) {
    return toErrorResponse(fail("invalid_target", "That alliance has been dissolved.").error);
  }

  // ── Add member ────────────────────────────────────────────────────────────
  const { error: insertError } = await admin
    .from("alliance_members")
    .insert({ alliance_id: alliance.id, player_id: player.id, role: "member" });

  if (insertError) {
    return toErrorResponse(
      fail("internal_error", "Failed to join alliance.").error,
    );
  }

  // ── Increment member_count ────────────────────────────────────────────────
  await admin
    .from("alliances")
    .update({ member_count: (alliance.member_count ?? 1) + 1 })
    .eq("id", alliance.id);

  return Response.json({
    ok: true,
    data: { allianceId: alliance.id, name: alliance.name, tag: alliance.tag },
  });
}
