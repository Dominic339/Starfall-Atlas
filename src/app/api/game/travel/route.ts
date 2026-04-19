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
import { listResult, maybeSingleResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { distanceBetween, computeArrivalTime } from "@/lib/game/travel";
import { findActiveLane } from "@/lib/game/gateResolution";
import { BALANCE } from "@/lib/config/balance";
import type { Ship, TravelJob } from "@/lib/types/game";

const CreateTravelSchema = z.object({
  destinationSystemId: z.string().min(1).max(64),
  /** Optional: explicitly select which ship to dispatch. */
  shipId: z.string().uuid().optional(),
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
  const { destinationSystemId, shipId: requestedShipId } = input.data;

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
  // Fetch all player ships. Players start with 2 ships; pick the first one
  // that is currently docked (current_system_id is not null) and is not at
  // the destination. If multiple ships are docked, the earliest-created ship
  // is chosen (implicit order by created_at via insert order).
  const { data: allShips } = listResult<Ship>(
    await admin
      .from("ships")
      .select("*")
      .eq("owner_id", player.id)
      .order("created_at", { ascending: true }),
  );

  // If caller specified a shipId, use that ship explicitly; otherwise auto-pick
  // the first available docked ship (legacy behaviour).
  let ship: Ship | null = null;
  if (requestedShipId) {
    const found = (allShips ?? []).find((s) => s.id === requestedShipId);
    if (!found) {
      return toErrorResponse(fail("not_found", "Ship not found.").error);
    }
    if (found.current_system_id === null) {
      return toErrorResponse(
        fail("job_in_progress", "That ship is already in transit.").error,
      );
    }
    if (found.current_system_id === destinationSystemId) {
      return toErrorResponse(
        fail("invalid_target", "That ship is already at the destination.").error,
      );
    }
    ship = found;
  } else {
    ship =
      (allShips ?? []).find(
        (s) =>
          s.current_system_id != null &&
          s.current_system_id !== destinationSystemId,
      ) ?? null;
  }

  if (!ship) {
    const anyShip = (allShips ?? []).length > 0;
    if (!anyShip) {
      return toErrorResponse(
        fail("not_found", "No ship found. Please sign out and back in.").error,
      );
    }
    const atDest = (allShips ?? []).some(
      (s) => s.current_system_id === destinationSystemId,
    );
    if (atDest) {
      return toErrorResponse(
        fail("invalid_target", "A ship is already at this system.").error,
      );
    }
    return toErrorResponse(
      fail("job_in_progress", "All your ships are currently in transit.").error,
    );
  }

  // ── Distance validation ──────────────────────────────────────────────────
  // ship.current_system_id is guaranteed non-null by the find() condition above.
  const fromSystemId = ship.current_system_id!;
  const fromEntry = getCatalogEntry(fromSystemId);
  if (!fromEntry) {
    return toErrorResponse(
      fail(
        "not_found",
        `Current system '${fromSystemId}' is not in the catalog.`,
      ).error,
    );
  }

  const distanceLy = distanceBetween(
    { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
    { x: destEntry.x, y: destEntry.y, z: destEntry.z },
  );

  // Phase 7: direct travel within base range; long-range via active lanes.
  const maxRangeLy = BALANCE.lanes.baseRangeLy;
  let laneId: string | null = null;

  if (distanceLy > maxRangeLy) {
    // Look for an active lane that connects these two systems and is accessible.
    // Fetch player's alliance membership for access-level checks.
    const { data: memberRow } = await admin
      .from("alliance_members")
      .select("alliance_id")
      .eq("player_id", player.id)
      .maybeSingle();
    const playerAllianceId = (memberRow as { alliance_id: string } | null)?.alliance_id ?? null;

    const lane = await findActiveLane(admin, fromSystemId, destinationSystemId, player.id, playerAllianceId);

    if (!lane) {
      return toErrorResponse(
        fail(
          "lane_out_of_range",
          `${destEntry.properName ?? destinationSystemId} is ${distanceLy.toFixed(2)} ly away. ` +
            `Maximum direct range is ${maxRangeLy} ly. ` +
            `Build a hyperspace gate and lane to reach this system.`,
        ).error,
      );
    }

    if (lane.access_level === "private" && lane.owner_id !== player.id) {
      return toErrorResponse(
        fail("forbidden", "This lane is private. Only its owner may use it.").error,
      );
    }

    if (lane.access_level === "alliance_only") {
      const { data: memberRow2 } = await admin
        .from("alliance_members")
        .select("alliance_id")
        .eq("player_id", player.id)
        .maybeSingle();
      const allianceId = (memberRow2 as { alliance_id: string } | null)?.alliance_id ?? null;
      if (allianceId !== lane.alliance_id) {
        return toErrorResponse(
          fail("forbidden", "This lane is restricted to a specific alliance.").error,
        );
      }
    }

    laneId = lane.id;
  }

  // ── Create travel job ────────────────────────────────────────────────────
  // fromSystemId is already defined above (guaranteed non-null from find())
  const now = new Date();
  const arriveAt = computeArrivalTime(now, distanceLy, ship.speed_ly_per_hr);

  // Step 1: Mark ship as in transit by clearing its location.
  // Also write Phase 32 unified state fields:
  //   ship_state             → 'traveling'
  //   last_known_system_id   → fromSystemId (stays populated while in transit)
  //   destination_system_id  → destinationSystemId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("ships")
    .update({
      current_system_id: null,
      current_body_id: null,
      ship_state: "traveling",
      last_known_system_id: fromSystemId,
      destination_system_id: destinationSystemId,
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
        lane_id: laneId,
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
      ship: {
        ...ship,
        current_system_id: null,
        current_body_id: null,
        ship_state: "traveling",
        last_known_system_id: fromSystemId,
        destination_system_id: destinationSystemId,
      },
    },
  });
}
