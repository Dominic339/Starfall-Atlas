/**
 * POST /api/game/ship/mode
 *
 * Updates a ship's dispatch mode.
 *
 * - Switching to an auto mode initialises auto_state = 'idle' so the
 *   automation loop picks up on the next dashboard load.
 * - Switching back to 'manual' clears auto_state and auto_target_colony_id,
 *   and cancels any pending auto travel job for the ship.
 *
 * Body: { shipId: string, mode: "manual" | "auto_collect_nearest" | "auto_collect_highest" }
 * Returns: { ok: true, data: { shipId, mode } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import type { Ship } from "@/lib/types/game";

const ModeSchema = z.object({
  shipId: z.string().uuid(),
  mode: z.enum(["manual", "auto_collect_nearest", "auto_collect_highest"]),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(ModeSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { shipId, mode } = input.data;

  const admin = createAdminClient();

  // ── Verify ownership ─────────────────────────────────────────────────────
  const { data: ship } = maybeSingleResult<Pick<Ship, "id" | "owner_id" | "dispatch_mode">>(
    await admin
      .from("ships")
      .select("id, owner_id, dispatch_mode")
      .eq("id", shipId)
      .maybeSingle(),
  );

  if (!ship || ship.owner_id !== player.id) {
    return toErrorResponse(fail("not_found", "Ship not found.").error);
  }

  // ── Build update payload ─────────────────────────────────────────────────
  const autoFields =
    mode === "manual"
      ? {
          dispatch_mode: "manual",
          auto_state: null,
          auto_target_colony_id: null,
        }
      : {
          dispatch_mode: mode,
          auto_state: "idle",
          auto_target_colony_id: null,
        };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("ships").update(autoFields).eq("id", shipId);

  // When switching back to manual, also cancel any pending auto travel job
  // so the "Arrive" button shows instead of the ship being stuck in transit.
  if (mode === "manual") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("travel_jobs")
      .update({ status: "cancelled" })
      .eq("ship_id", shipId)
      .eq("status", "pending");

    // Restore ship location to the destination it was heading to (best effort).
    // This avoids leaving the ship with current_system_id = null after cancellation.
    const { data: cancelledJob } = maybeSingleResult<{
      to_system_id: string;
    }>(
      await admin
        .from("travel_jobs")
        .select("to_system_id")
        .eq("ship_id", shipId)
        .eq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );

    if (cancelledJob) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("ships")
        .update({ current_system_id: cancelledJob.to_system_id, current_body_id: null })
        .eq("id", shipId)
        .is("current_system_id", null); // only restore if still in transit
    }
  }

  return Response.json({ ok: true, data: { shipId, mode } });
}
