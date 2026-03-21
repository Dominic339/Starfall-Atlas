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

  // ── Caller must be founder ────────────────────────────────────────────────
  const { data: callerMembership } = maybeSingleResult<{
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

  if (!callerMembership) {
    return toErrorResponse(fail("not_found", "You are not in an alliance.").error);
  }
  if (callerMembership.role !== "founder") {
    return toErrorResponse(
      fail("forbidden", "Only the alliance founder may change member roles.").error,
    );
  }

  // ── Target must be in the same alliance ───────────────────────────────────
  const { data: targetMembership } = maybeSingleResult<{
    id: string;
    alliance_id: string;
    role: string;
  }>(
    await admin
      .from("alliance_members")
      .select("id, alliance_id, role")
      .eq("player_id", targetPlayerId)
      .eq("alliance_id", callerMembership.alliance_id)
      .maybeSingle(),
  );

  if (!targetMembership) {
    return toErrorResponse(
      fail("not_found", "Target player is not a member of your alliance.").error,
    );
  }

  // ── Apply role change ─────────────────────────────────────────────────────
  await admin
    .from("alliance_members")
    .update({ role: newRole })
    .eq("id", targetMembership.id);

  // If transferring leadership, demote caller to officer
  if (newRole === "founder") {
    await admin
      .from("alliance_members")
      .update({ role: "officer" })
      .eq("id", callerMembership.id);

    // Update founder_id on the alliance record
    await admin
      .from("alliances")
      .update({ founder_id: targetPlayerId })
      .eq("id", callerMembership.alliance_id);
  }

  return Response.json({ ok: true });
}
