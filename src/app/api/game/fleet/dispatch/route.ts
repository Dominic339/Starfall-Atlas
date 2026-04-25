/**
 * POST /api/game/fleet/dispatch
 *
 * Dispatches a fleet to a destination system, creating one travel job per
 * member ship. Fleet speed is the slowest member ship; all jobs share the
 * same arrive_at so the fleet travels as a unit.
 *
 * Validation:
 *   1. Auth
 *   2. Input: fleetId (UUID), destinationSystemId (string)
 *   3. Fleet exists, is owned by the player, and is status='active'
 *   4. Destination is in the catalog
 *   5. Fleet's current_system_id is set (guaranteed when status='active')
 *   6. Distance from current system ≤ base travel range
 *   7. Fetch member ships — confirm all still docked at fleet system
 *
 * Atomicity: ships cleared in bulk, then travel jobs inserted in bulk.
 * fleet.status flipped to 'traveling' and current_system_id cleared.
 *
 * Body:   { fleetId: string, destinationSystemId: string }
 * Returns: { ok: true, data: { fleetId, destinationSystemId, arriveAt, shipCount } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult, maybeSingleResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { distanceBetween, computeArrivalTime } from "@/lib/game/travel";
import { getBalanceWithOverrides } from "@/lib/config/balanceOverrides";
import type { Fleet, FleetShip, Ship } from "@/lib/types/game";

const DispatchFleetSchema = z.object({
  fleetId: z.string().uuid(),
  destinationSystemId: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(DispatchFleetSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { fleetId, destinationSystemId } = input.data;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balance = await getBalanceWithOverrides(admin as any);

  // ── Fetch fleet ───────────────────────────────────────────────────────────
  const { data: fleet } = maybeSingleResult<Fleet>(
    await admin
      .from("fleets")
      .select("*")
      .eq("id", fleetId)
      .maybeSingle(),
  );

  if (!fleet) {
    return toErrorResponse(fail("not_found", "Fleet not found.").error);
  }
  if (fleet.player_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You do not own this fleet.").error);
  }
  if (fleet.status !== "active") {
    return toErrorResponse(
      fail(
        "job_in_progress",
        fleet.status === "traveling"
          ? "Fleet is already in transit."
          : "Fleet has been disbanded.",
      ).error,
    );
  }

  const fromSystemId = fleet.current_system_id!;

  // ── Catalog validation ────────────────────────────────────────────────────
  if (destinationSystemId === fromSystemId) {
    return toErrorResponse(
      fail("invalid_target", "Fleet is already in that system.").error,
    );
  }

  const fromEntry = getCatalogEntry(fromSystemId);
  const destEntry = getCatalogEntry(destinationSystemId);

  if (!fromEntry) {
    return toErrorResponse(
      fail("not_found", `Current system '${fromSystemId}' is not in the catalog.`).error,
    );
  }
  if (!destEntry) {
    return toErrorResponse(
      fail("not_found", `Destination system '${destinationSystemId}' is not in the catalog.`).error,
    );
  }

  // ── Distance check ────────────────────────────────────────────────────────
  const distanceLy = distanceBetween(
    { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
    { x: destEntry.x, y: destEntry.y, z: destEntry.z },
  );

  const maxRangeLy = balance.lanes.baseRangeLy;
  if (distanceLy > maxRangeLy) {
    return toErrorResponse(
      fail(
        "lane_out_of_range",
        `${destEntry.properName ?? destinationSystemId} is ${distanceLy.toFixed(2)} ly away. ` +
          `Maximum direct travel range is ${maxRangeLy} ly.`,
      ).error,
    );
  }

  // ── Fetch member ships ────────────────────────────────────────────────────
  const { data: fleetShipRows } = listResult<FleetShip>(
    await admin
      .from("fleet_ships")
      .select("ship_id")
      .eq("fleet_id", fleetId),
  );

  const memberShipIds = (fleetShipRows ?? []).map((r) => r.ship_id);
  if (memberShipIds.length === 0) {
    return toErrorResponse(
      fail("invalid_target", "Fleet has no member ships.").error,
    );
  }

  const { data: memberShips } = listResult<Ship>(
    await admin
      .from("ships")
      .select("id, owner_id, current_system_id, current_body_id, speed_ly_per_hr")
      .in("id", memberShipIds),
  );

  const ships = memberShips ?? [];

  // Verify all ships are still docked at the fleet's system
  const notDocked = ships.find(
    (s) => s.current_system_id !== fromSystemId,
  );
  if (notDocked) {
    return toErrorResponse(
      fail(
        "job_in_progress",
        "One or more fleet ships are not docked at the fleet system. Resolve travel first.",
      ).error,
    );
  }

  // ── Fleet speed = slowest ship ────────────────────────────────────────────
  const fleetSpeed = Math.min(...ships.map((s) => s.speed_ly_per_hr));

  const now = new Date();
  const arriveAt = computeArrivalTime(now, distanceLy, fleetSpeed);

  // ── Update fleet status ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("fleets")
    .update({ status: "traveling", current_system_id: null, updated_at: now.toISOString() })
    .eq("id", fleetId);

  // ── Clear ship locations (bulk) ───────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("ships")
    .update({ current_system_id: null, current_body_id: null })
    .in("id", memberShipIds);

  // ── Insert one travel job per ship ────────────────────────────────────────
  const jobRows = ships.map((s) => ({
    ship_id: s.id,
    player_id: player.id,
    from_system_id: fromSystemId,
    to_system_id: destinationSystemId,
    lane_id: null,
    fleet_id: fleetId,
    depart_at: now.toISOString(),
    arrive_at: arriveAt.toISOString(),
    transit_tax_paid: 0,
    status: "pending",
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("travel_jobs").insert(jobRows);

  return Response.json({
    ok: true,
    data: {
      fleetId,
      destinationSystemId,
      arriveAt: arriveAt.toISOString(),
      shipCount: ships.length,
    },
  });
}
