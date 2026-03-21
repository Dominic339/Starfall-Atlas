/**
 * POST /api/game/alliance/beacon/remove
 *
 * Deactivates (soft-removes) an alliance beacon.
 *
 * Validation:
 *   1. Auth
 *   2. Input: beaconId (UUID)
 *   3. Player is in an alliance with role 'founder' or 'officer'
 *   4. Beacon belongs to the player's alliance and is currently active
 *
 * Body:   { beaconId: string }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const RemoveBeaconSchema = z.object({
  beaconId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(RemoveBeaconSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { beaconId } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Player membership and role ────────────────────────────────────────────
  const { data: membership } = maybeSingleResult<{
    alliance_id: string;
    role: string;
  }>(
    await admin
      .from("alliance_members")
      .select("alliance_id, role")
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  if (!membership) {
    return toErrorResponse(fail("forbidden", "You are not in an alliance.").error);
  }
  if (membership.role !== "founder" && membership.role !== "officer") {
    return toErrorResponse(
      fail("forbidden", "Only alliance founders and officers may remove beacons.").error,
    );
  }

  // ── Verify beacon belongs to this alliance and is active ──────────────────
  const { data: beacon } = maybeSingleResult<{ id: string; alliance_id: string; is_active: boolean }>(
    await admin
      .from("alliance_beacons")
      .select("id, alliance_id, is_active")
      .eq("id", beaconId)
      .maybeSingle(),
  );

  if (!beacon) {
    return toErrorResponse(fail("not_found", "Beacon not found.").error);
  }
  if (beacon.alliance_id !== membership.alliance_id) {
    return toErrorResponse(fail("forbidden", "That beacon does not belong to your alliance.").error);
  }
  if (!beacon.is_active) {
    return toErrorResponse(fail("invalid_target", "That beacon is already inactive.").error);
  }

  // ── Soft-remove beacon ────────────────────────────────────────────────────
  await admin
    .from("alliance_beacons")
    .update({ is_active: false, removed_at: new Date().toISOString() })
    .eq("id", beaconId);

  return Response.json({ ok: true });
}
