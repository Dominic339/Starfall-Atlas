/**
 * POST /api/game/ship/assign-colony
 *
 * Sets or clears a ship's pinned colony assignment.
 * The pinned colony is prioritised by auto-haul over the normal
 * nearest/highest-yield selection, without hard-locking the ship
 * (it falls back to normal logic if the pinned colony has no stockpile).
 *
 * Body:   { shipId: string, colonyId: string | null }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import type { Ship } from "@/lib/types/game";

const AssignColonySchema = z.object({
  shipId: z.string().uuid(),
  /** UUID of the colony to assign, or null to clear. */
  colonyId: z.string().uuid().nullable(),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(AssignColonySchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { shipId, colonyId } = input.data;

  const admin = createAdminClient();

  // ── Verify ship + colony ownership in parallel ──────────────────────────
  const [shipRes, colonyRes] = await Promise.all([
    admin.from("ships").select("id, owner_id").eq("id", shipId).maybeSingle(),
    colonyId !== null
      ? admin.from("colonies").select("id, owner_id").eq("id", colonyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const { data: ship } = maybeSingleResult<Pick<Ship, "id" | "owner_id">>(shipRes);
  if (!ship || ship.owner_id !== player.id) {
    return toErrorResponse(fail("not_found", "Ship not found.").error);
  }

  if (colonyId !== null) {
    const { data: colony } = maybeSingleResult<{ id: string; owner_id: string }>(colonyRes);
    if (!colony || colony.owner_id !== player.id) {
      return toErrorResponse(fail("not_found", "Colony not found.").error);
    }
  }

  // ── Update ───────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("ships")
    .update({ pinned_colony_id: colonyId })
    .eq("id", shipId);

  if (error) {
    return Response.json(
      { ok: false, error: { code: "internal_error", message: "Failed to update assignment." } },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
