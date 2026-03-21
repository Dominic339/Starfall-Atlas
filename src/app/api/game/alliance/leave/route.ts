/**
 * POST /api/game/alliance/leave
 *
 * Leaves the player's current alliance.
 *
 * Validation:
 *   1. Auth
 *   2. Player is in an alliance
 *   3. Player is not the founder (founders must transfer or disband — not yet implemented)
 *
 * Deletes the alliance_members row and decrements member_count.
 *
 * Body:   {}
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

export async function POST(_request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Fetch membership ──────────────────────────────────────────────────────
  const { data: membership } = maybeSingleResult<{
    id: string;
    alliance_id: string;
    role: string;
  }>(
    await admin
      .from("alliance_members")
      .select("id, alliance_id, role")
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  if (!membership) {
    return toErrorResponse(fail("not_found", "You are not in an alliance.").error);
  }

  if (membership.role === "founder") {
    return toErrorResponse(
      fail(
        "invalid_target",
        "Founders cannot leave directly. Transfer leadership to an officer first, then leave.",
      ).error,
    );
  }

  // ── Fetch current member_count ────────────────────────────────────────────
  const { data: alliance } = maybeSingleResult<{ member_count: number }>(
    await admin
      .from("alliances")
      .select("member_count")
      .eq("id", membership.alliance_id)
      .maybeSingle(),
  );

  // ── Delete membership ─────────────────────────────────────────────────────
  await admin
    .from("alliance_members")
    .delete()
    .eq("id", membership.id);

  // ── Decrement member_count ────────────────────────────────────────────────
  if (alliance && alliance.member_count > 1) {
    await admin
      .from("alliances")
      .update({ member_count: alliance.member_count - 1 })
      .eq("id", membership.alliance_id);
  }

  return Response.json({ ok: true });
}
