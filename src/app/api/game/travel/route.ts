/**
 * POST /api/game/travel
 *
 * Creates a travel job, placing the player's ship in transit to a
 * destination system.
 *
 * Validation:
 *   1. Authenticated player with an existing player row.
 *   2. Player owns exactly one ship (starter ship from bootstrap).
 *   3. Ship is not currently in transit (current_system_id IS NOT NULL).
 *   4. Destination exists in the alpha catalog.
 *   5. Distance from current system to destination ≤ base travel range (10 ly).
 *      (Phase 4: lane-free direct travel within base range. Lanes extend range
 *      once built. TODO: add lane path validation when lanes exist.)
 *
 * Atomicity note: ship location is cleared and travel_jobs row is inserted
 * in two separate statements. This is acceptable for Phase 4 with a single
 * ship per player. TODO: wrap in a Postgres RPC for full transactional safety.
 *
 * Body: { destinationSystemId: string }
 * Returns: { ok: true, data: { job: TravelJob, ship: Ship } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult, maybeSingleResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { distanceBetween, computeArrivalTime } from "@/lib/game/travel";
import { BALANCE } from "@/lib/config/balance";
import type { Ship, TravelJob } from "@/lib/types/game";

const CreateTravelSchema = z.object({
  destinationSystemId: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(CreateTravelSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { destinationSystemId } = input.data;

  // ── Catalog validation ───────────────────────────────────────────────────
  const destEntry = getCatalogEntry(destinationSystemId);
  if (!destEntry) {
    return toErrorResponse(
      fail(
        "not_found",
        `System '${destinationSystemId}' is not in the catalog.`,
      ).error,
    );
  }

  const admin = createAdminClient();

  // ── Ship validation ──────────────────────────────────────────────────────
  // Fetch the player's ship (one ship per player in Phase 4).
  const { data: ship } = singleResult<Ship>(
    await admin
      .from("ships")
      .select("*")
      .eq("owner_id", player.id)
      .single(),
  );

  if (!ship) {
    return toErrorResponse(
      fail("not_found", "No ship found. Please sign out and back in.").error,
    );
  }

  if (!ship.current_system_id) {
    return toErrorResponse(
      fail("job_in_progress", "Your ship is already in transit.").error,
    );
  }

  if (ship.current_system_id === destinationSystemId) {
    return toErrorResponse(
      fail("invalid_target", "Your ship is already at this system.").error,
    );
  }

  // ── Distance validation ──────────────────────────────────────────────────
  const fromEntry = getCatalogEntry(ship.current_system_id);
  if (!fromEntry) {
    return toErrorResponse(
      fail(
        "not_found",
        `Current system '${ship.current_system_id}' is not in the catalog.`,
      ).error,
    );
  }

  const distanceLy = distanceBetween(
    { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
    { x: destEntry.x, y: destEntry.y, z: destEntry.z },
  );

  // Phase 4: direct travel within base range (no lane required).
  // Relay stations and lanes extend this range in later phases.
  const maxRangeLy = BALANCE.lanes.baseRangeLy;
  if (distanceLy > maxRangeLy) {
    return toErrorResponse(
      fail(
        "lane_out_of_range",
        `${destEntry.properName ?? destinationSystemId} is ${distanceLy.toFixed(2)} ly away. ` +
          `Maximum direct travel range is ${maxRangeLy} ly. ` +
          `Build relay stations to extend your reach.`,
      ).error,
    );
  }

  // ── Create travel job ────────────────────────────────────────────────────
  const fromSystemId = ship.current_system_id; // save before clearing
  const now = new Date();
  const arriveAt = computeArrivalTime(now, distanceLy, ship.speed_ly_per_hr);

  // Step 1: Mark ship as in transit by clearing its location.
  // This must happen before inserting the job so that concurrent requests see
  // the ship as in transit and reject with job_in_progress.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("ships")
    .update({
      current_system_id: null,
      current_body_id: null,
    })
    .eq("id", ship.id);

  // Step 2: Insert the travel job.
  const { data: job } = maybeSingleResult<TravelJob>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("travel_jobs")
      .insert({
        ship_id: ship.id,
        player_id: player.id,
        from_system_id: fromSystemId,
        to_system_id: destinationSystemId,
        lane_id: null,
        depart_at: now.toISOString(),
        arrive_at: arriveAt.toISOString(),
        transit_tax_paid: 0,
        status: "pending",
      })
      .select("*")
      .maybeSingle(),
  );

  if (!job) {
    // Rollback: restore ship to its previous location.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("ships")
      .update({
        current_system_id: fromSystemId,
        current_body_id: ship.current_body_id,
      })
      .eq("id", ship.id);

    return Response.json(
      {
        ok: false,
        error: {
          code: "internal_error",
          message: "Failed to create travel job. Ship location restored.",
        },
      },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    data: {
      job,
      ship: { ...ship, current_system_id: null, current_body_id: null },
    },
  });
}
