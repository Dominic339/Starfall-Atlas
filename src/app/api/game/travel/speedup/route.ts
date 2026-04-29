/**
 * POST /api/game/travel/speedup
 *
 * Spends credits to reduce the arrive_at of an in-transit travel job by
 * SPEEDUP_HOURS hours. Deducts COST_PER_SPEEDUP credits per use.
 * If the speedup would push arrive_at into the past, arrive_at is set to now
 * so the next engine tick resolves the job immediately.
 *
 * Body: { travelJobId: string }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

export const dynamic = "force-dynamic";

const SPEEDUP_HOURS    = 1;   // hours shaved off per use
const COST_PER_SPEEDUP = 25;  // credits per use

const SpeedupSchema = z.object({
  travelJobId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await req.json().catch(() => ({}));
  const input = parseInput(SpeedupSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { travelJobId } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Verify the travel job belongs to this player and is still pending
  const { data: job } = maybeSingleResult<{ id: string; arrive_at: string; fleet_id: string | null }>(
    await admin
      .from("travel_jobs")
      .select("id, arrive_at, fleet_id")
      .eq("id", travelJobId)
      .eq("player_id", player.id)
      .eq("status", "pending")
      .maybeSingle(),
  );

  if (!job) return toErrorResponse(fail("not_found", "Travel job not found or already completed.").error);

  if (player.credits < COST_PER_SPEEDUP) {
    return toErrorResponse(fail("insufficient_credits", `Not enough credits. Need ${COST_PER_SPEEDUP} credits.`).error);
  }

  // Compute new arrive_at — clamp to now (cannot set in the past)
  const currentArrival = new Date(job.arrive_at).getTime();
  const newArrival     = Math.max(Date.now(), currentArrival - SPEEDUP_HOURS * 3600 * 1000);
  const newArrivalIso  = new Date(newArrival).toISOString();

  // If this is a fleet job, update ALL pending jobs in the fleet so members arrive together
  if (job.fleet_id) {
    const { error: fleetErr } = await admin
      .from("travel_jobs")
      .update({ arrive_at: newArrivalIso })
      .eq("fleet_id", job.fleet_id)
      .eq("status", "pending");
    if (fleetErr) {
      console.error("[speedup] fleet update error:", fleetErr);
      return toErrorResponse(fail("internal_error", "Failed to apply speedup.").error);
    }
  } else {
    const { error: jobErr } = await admin
      .from("travel_jobs")
      .update({ arrive_at: newArrivalIso })
      .eq("id", travelJobId);
    if (jobErr) {
      console.error("[speedup] job update error:", jobErr);
      return toErrorResponse(fail("internal_error", "Failed to apply speedup.").error);
    }
  }

  // Deduct credits (best-effort — arrive_at already updated)
  await admin
    .from("players")
    .update({ credits: player.credits - COST_PER_SPEEDUP })
    .eq("id", player.id);

  const hoursRemaining = Math.max(0, newArrival - Date.now()) / 3600000;

  return Response.json({
    ok: true,
    data: {
      newArriveAt: newArrivalIso,
      creditsSpent: COST_PER_SPEEDUP,
      creditsRemaining: player.credits - COST_PER_SPEEDUP,
      hoursRemaining: Math.round(hoursRemaining * 10) / 10,
    },
  });
}
