/**
 * POST /api/game/account/delete
 *
 * Soft-deletes the authenticated player's account by setting deactivated_at.
 * The game layout redirects deactivated players to /deactivated on every load.
 *
 * This does NOT delete data immediately — a background job or support team
 * can hard-delete after the retention window.
 *
 * Body:   { confirm: "DELETE MY ACCOUNT" }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

const DeleteAccountSchema = z.object({
  confirm: z.literal(CONFIRM_PHRASE),
});

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ─────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(DeleteAccountSchema, body);
  if (!input.ok) {
    return toErrorResponse(
      fail(
        "validation_error",
        `You must type "${CONFIRM_PHRASE}" exactly to confirm deletion.`,
      ).error,
    );
  }

  // ── Soft delete ───────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date().toISOString();

  const { error } = await admin
    .from("players")
    .update({ deactivated_at: now })
    .eq("id", player.id);

  if (error) {
    return toErrorResponse(fail("internal_error", "Failed to deactivate account.").error);
  }

  return Response.json({ ok: true });
}
