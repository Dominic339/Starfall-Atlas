/**
 * POST /api/dev/travel/complete
 *
 * DEV-ONLY: Instantly completes all pending travel jobs for the current player.
 * Sets arrive_at to now, marks jobs complete, and moves ships to their destinations.
 *
 * Gated by NODE_ENV !== 'production'. Returns 403 in production.
 *
 * Returns: { ok: true, data: { completed: number } }
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import type { TravelJob } from "@/lib/types/game";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return toErrorResponse(
      fail("forbidden", "This endpoint is not available in production.").error,
    );
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;

  // ── Fetch all pending travel jobs for this player ─────────────────────
  const { data: pendingJobs } = listResult<TravelJob>(
    await admin
      .from("travel_jobs")
      .select("*")
      .eq("player_id", player.id)
      .eq("status", "pending"),
  );

  if (!pendingJobs || pendingJobs.length === 0) {
    return Response.json({ ok: true, data: { completed: 0 } });
  }

  // ── Resolve each job: mark complete + move ship ───────────────────────
  let completed = 0;
  for (const job of pendingJobs) {
    await adminAny
      .from("travel_jobs")
      .update({ status: "complete" })
      .eq("id", job.id);

    await adminAny
      .from("ships")
      .update({ current_system_id: job.to_system_id, current_body_id: null })
      .eq("id", job.ship_id);

    completed++;
  }

  return Response.json({ ok: true, data: { completed } });
}
