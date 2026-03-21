/**
 * POST /api/game/fleet/disband
 *
 * Disbands a fleet that is currently staged (status='active').
 * Removes all fleet_ships rows, sets fleet.status='disbanded'.
 * Ships are freed and revert to individual manual dispatch.
 *
 * Fleets in transit cannot be disbanded — dispatch must complete first.
 *
 * Body:   { fleetId: string }
 * Returns: { ok: true, data: { fleetId, disbandedAt } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import type { Fleet } from "@/lib/types/game";

const DisbandFleetSchema = z.object({
  fleetId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(DisbandFleetSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { fleetId } = input.data;

  const admin = createAdminClient();

  // ── Fetch fleet ───────────────────────────────────────────────────────────
  const { data: fleet } = maybeSingleResult<Fleet>(
    await admin
      .from("fleets")
      .select("id, player_id, status")
      .eq("id", fleetId)
      .maybeSingle(),
  );

  if (!fleet) {
    return toErrorResponse(fail("not_found", "Fleet not found.").error);
  }
  if (fleet.player_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You do not own this fleet.").error);
  }
  if (fleet.status === "disbanded") {
    return toErrorResponse(fail("invalid_target", "Fleet is already disbanded.").error);
  }
  if (fleet.status === "traveling") {
    return toErrorResponse(
      fail(
        "job_in_progress",
        "Cannot disband a fleet that is currently in transit. Wait for it to arrive.",
      ).error,
    );
  }

  const now = new Date();

  // ── Remove fleet_ships rows (ships are freed) ─────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("fleet_ships")
    .delete()
    .eq("fleet_id", fleetId);

  // ── Mark fleet disbanded ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("fleets")
    .update({
      status: "disbanded",
      disbanded_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", fleetId);

  return Response.json({
    ok: true,
    data: {
      fleetId,
      disbandedAt: now.toISOString(),
    },
  });
}
