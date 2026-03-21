/**
 * POST /api/game/profile/update
 *
 * Updates the authenticated player's editable profile fields.
 * All fields are optional — only provided fields are updated.
 *
 * Handle rules:
 *   - 3–32 characters
 *   - Alphanumeric and underscores only (A-Z, a-z, 0-9, _)
 *   - Must be unique
 *
 * Body:   { handle?: string, title?: string, bio?: string }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const HANDLE_RE = /^[A-Za-z0-9_]+$/;

const UpdateProfileSchema = z.object({
  handle: z
    .string()
    .min(3)
    .max(32)
    .regex(HANDLE_RE, "Handle may only contain letters, digits, and underscores.")
    .optional(),
  title: z.string().max(64).optional().nullable(),
  bio:   z.string().max(512).optional().nullable(),
});

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ─────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(UpdateProfileSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { handle, title, bio } = input.data;

  if (!handle && title === undefined && bio === undefined) {
    return toErrorResponse(fail("validation_error", "No fields to update.").error);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Handle uniqueness check ───────────────────────────────────────────────
  if (handle && handle.toLowerCase() !== (player.handle ?? "").toLowerCase()) {
    const { data: existing } = maybeSingleResult<{ id: string }>(
      await admin
        .from("players")
        .select("id")
        .ilike("handle", handle)
        .neq("id", player.id)
        .maybeSingle(),
    );
    if (existing) {
      return toErrorResponse(
        fail("already_exists", "That handle is already taken.").error,
      );
    }
  }

  // ── Build update payload ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {};
  if (handle !== undefined) updates.handle = handle;
  if (title  !== undefined) updates.title  = title;
  if (bio    !== undefined) updates.bio    = bio;

  const { error } = await admin
    .from("players")
    .update(updates)
    .eq("id", player.id);

  if (error) {
    return toErrorResponse(fail("internal_error", "Failed to update profile.").error);
  }

  return Response.json({ ok: true });
}
