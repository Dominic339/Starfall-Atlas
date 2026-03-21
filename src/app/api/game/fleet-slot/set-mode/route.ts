/**
 * POST /api/game/fleet-slot/set-mode
 *
 * Changes the dispatch mode of a fleet slot.
 *
 * Switching to manual clears auto_state and auto_target_colony_id so the slot
 * stops driving the auto loop. The current fleet (if any) is kept staged and
 * the player can disband or dispatch it manually.
 *
 * Switching to an auto mode leaves any existing fleet in place — the auto loop
 * will pick it up on the next page load.
 *
 * Body:   { slotId: string, mode: "manual" | "auto_collect_nearest" | "auto_collect_highest" }
 * Returns: { ok: true, data: { slotId, mode } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import type { FleetSlot } from "@/lib/types/game";

const SetModeSchema = z.object({
  slotId: z.string().uuid(),
  mode: z.enum(["manual", "auto_collect_nearest", "auto_collect_highest"]),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(SetModeSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { slotId, mode } = input.data;

  const admin = createAdminClient();

  // ── Fetch slot ────────────────────────────────────────────────────────────
  const { data: slot } = maybeSingleResult<FleetSlot>(
    await admin
      .from("player_fleet_slots")
      .select("id, player_id, mode")
      .eq("id", slotId)
      .maybeSingle(),
  );

  if (!slot) {
    return toErrorResponse(fail("not_found", "Fleet slot not found.").error);
  }
  if (slot.player_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You do not own this fleet slot.").error);
  }
  if (slot.mode === mode) {
    // No-op — idempotent
    return Response.json({ ok: true, data: { slotId, mode } });
  }

  // ── Build update patch ────────────────────────────────────────────────────
  // When switching to manual, stop the auto loop.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {
    mode,
    updated_at: new Date().toISOString(),
  };
  if (mode === "manual") {
    patch.auto_state = null;
    patch.auto_target_colony_id = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("player_fleet_slots")
    .update(patch)
    .eq("id", slotId);

  return Response.json({ ok: true, data: { slotId, mode } });
}
