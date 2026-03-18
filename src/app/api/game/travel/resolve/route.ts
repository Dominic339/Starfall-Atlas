/**
 * POST /api/game/travel/resolve
 *
 * Resolves a completed travel job, moving the ship to the destination system.
 *
 * Validation:
 *   1. Authenticated player.
 *   2. Travel job exists with the given jobId and belongs to this player.
 *   3. Job status is 'pending' (not already resolved).
 *   4. arrive_at timestamp has passed (arrival time reached server-side).
 *
 * Updates (atomic via sequential statements — see atomicity note in travel/route.ts):
 *   - travel_jobs: status → 'complete'
 *   - ships: current_system_id → to_system_id, current_body_id → null
 *
 * Body: { jobId: string }
 * Returns: { ok: true, data: { ship: Ship, job: TravelJob } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult } from "@/lib/supabase/utils";
import type { Ship, TravelJob } from "@/lib/types/game";

const ResolveTravelSchema = z.object({
  jobId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(ResolveTravelSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { jobId } = input.data;

  const admin = createAdminClient();

  // ── Fetch travel job ─────────────────────────────────────────────────────
  const { data: job } = singleResult<TravelJob>(
    await admin
      .from("travel_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("player_id", player.id)
      .single(),
  );

  if (!job) {
    return toErrorResponse(
      fail("not_found", "Travel job not found.").error,
    );
  }

  if (job.status !== "pending") {
    return toErrorResponse(
      fail(
        "invalid_target",
        `Travel job is already '${job.status}'.`,
      ).error,
    );
  }

  // ── Check arrival time ───────────────────────────────────────────────────
  const now = new Date();
  const arriveAt = new Date(job.arrive_at);

  if (now < arriveAt) {
    const remainingMs = arriveAt.getTime() - now.getTime();
    const remainingMinutes = Math.ceil(remainingMs / 60_000);
    return toErrorResponse(
      fail(
        "job_in_progress",
        `Ship has not arrived yet. Estimated time remaining: ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}.`,
      ).error,
    );
  }

  // ── Resolve: update job and ship ─────────────────────────────────────────
  // Mark job complete first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("travel_jobs")
    .update({ status: "complete" })
    .eq("id", job.id);

  // Move ship to destination.
  const { data: ship } = singleResult<Ship>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("ships")
      .update({
        current_system_id: job.to_system_id,
        current_body_id: null,
      })
      .eq("id", job.ship_id)
      .select("*")
      .single(),
  );

  if (!ship) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "internal_error",
          message: "Failed to update ship location after travel job resolved.",
        },
      },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    data: { job: { ...job, status: "complete" }, ship },
  });
}
