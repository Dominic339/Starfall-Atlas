/**
 * POST /api/game/alliance/promote
 *
 * Sets a member's role. Only the alliance founder may call this.
 *
 * Supported transitions:
 *   member   → officer
 *   officer  → member
 *   officer  → founder  (transfers leadership; caller becomes 'officer')
 *
 * Body:   { targetPlayerId: string, newRole: "officer" | "member" | "founder" }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const PromoteSchema = z.object({
  targetPlayerId: z.string().uuid(),
  newRole: z.enum(["officer", "member", "founder"]),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(PromoteSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { targetPlayerId, newRole } = input.data;

  if (targetPlayerId === player.id) {
    return toErrorResponse(fail("invalid_target", "You cannot change your own role this way.").error);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Fetch both memberships in parallel ───────────────────────────────────
  type MemberRow = { id: string; alliance_id: string; role: string };
  const [callerRes, targetRes] = await Promise.all([
    admin.from("alliance_members").select("id, alliance_id, role").eq("player_id", player.id).maybeSingle(),
    admin.from("alliance_members").select("id, alliance_id, role").eq("player_id", targetPlayerId).maybeSingle(),
  ]);

  const { data: callerMembership } = maybeSingleResult<MemberRow>(callerRes);
  if (!callerMembership) return toErrorResponse(fail("not_found", "You are not in an alliance.").error);
  if (callerMembership.role !== "founder") {
    return toErrorResponse(fail("forbidden", "Only the alliance founder may change member roles.").error);
  }

  const { data: targetMembership } = maybeSingleResult<MemberRow>(targetRes);
  if (!targetMembership || targetMembership.alliance_id !== callerMembership.alliance_id) {
    return toErrorResponse(fail("not_found", "Target player is not a member of your alliance.").error);
  }

  // ── Apply role change ─────────────────────────────────────────────────────
  if (newRole === "founder") {
    // Transfer leadership: update target + caller + alliance record in parallel
    await Promise.all([
      admin.from("alliance_members").update({ role: "founder" }).eq("id", targetMembership.id),
      admin.from("alliance_members").update({ role: "officer" }).eq("id", callerMembership.id),
      admin.from("alliances").update({ founder_id: targetPlayerId }).eq("id", callerMembership.alliance_id),
    ]);
  } else {
    await admin.from("alliance_members").update({ role: newRole }).eq("id", targetMembership.id);
  }

  return Response.json({ ok: true });
}
