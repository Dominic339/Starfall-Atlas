/**
 * POST /api/game/fleet/create
 *
 * Creates a fleet from a set of co-located ships owned by the player.
 *
 * Validation:
 *   1. Auth
 *   2. Input: shipIds (non-empty array of UUIDs, 2–20 ships)
 *   3. All ships exist and are owned by the player
 *   4. All ships are docked (current_system_id IS NOT NULL)
 *   5. All ships are in the same system
 *   6. No ship is already in an active fleet
 *   7. All ships are in manual dispatch mode (or are switched to manual)
 *
 * Fleet is named "Fleet N" where N = count of non-disbanded fleets + 1.
 *
 * Body:   { shipIds: string[] }
 * Returns: { ok: true, data: { fleetId: string, name: string, systemId: string, shipIds: string[] } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult, maybeSingleResult } from "@/lib/supabase/utils";
import type { Ship, Fleet, FleetShip } from "@/lib/types/game";

const CreateFleetSchema = z.object({
  shipIds: z.array(z.string().uuid()).min(2).max(20),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(CreateFleetSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { shipIds } = input.data;

  const admin = createAdminClient();

  // ── Fetch ships ───────────────────────────────────────────────────────────
  const { data: ships } = listResult<Ship>(
    await admin
      .from("ships")
      .select("id, owner_id, current_system_id, current_body_id, dispatch_mode")
      .in("id", shipIds),
  );

  const foundShips = ships ?? [];

  // Verify all requested ships were found
  if (foundShips.length !== shipIds.length) {
    return toErrorResponse(
      fail("not_found", "One or more ships were not found.").error,
    );
  }

  // Verify ownership
  const unowned = foundShips.find((s) => s.owner_id !== player.id);
  if (unowned) {
    return toErrorResponse(
      fail("forbidden", "You do not own all the specified ships.").error,
    );
  }

  // Verify all docked (not in transit)
  const inTransit = foundShips.find((s) => s.current_system_id === null);
  if (inTransit) {
    return toErrorResponse(
      fail("job_in_progress", "All ships must be docked to form a fleet. One or more ships are currently in transit.").error,
    );
  }

  // Verify co-location (all in same system)
  const systems = new Set(foundShips.map((s) => s.current_system_id!));
  if (systems.size > 1) {
    return toErrorResponse(
      fail("invalid_target", "All ships must be in the same system to form a fleet.").error,
    );
  }
  const systemId = [...systems][0]!;

  // Verify no ship is already in an active fleet
  const { data: existingRows } = listResult<FleetShip>(
    await admin
      .from("fleet_ships")
      .select("ship_id, fleet_id")
      .in("ship_id", shipIds),
  );

  if ((existingRows ?? []).length > 0) {
    return toErrorResponse(
      fail("invalid_target", "One or more ships are already members of an active fleet.").error,
    );
  }

  // ── Determine fleet name ──────────────────────────────────────────────────
  const { data: fleetCountRow } = maybeSingleResult<{ count: string }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("fleets")
      .select("id", { count: "exact", head: true })
      .eq("player_id", player.id),
  );
  // count comes from the PostgREST count header; use a simple DB count approach
  const { count: fleetCount } = await (admin as any)
    .from("fleets")
    .select("id", { count: "exact", head: true })
    .eq("player_id", player.id);
  const fleetName = `Fleet ${(fleetCount ?? 0) + 1}`;

  // ── Create fleet ──────────────────────────────────────────────────────────
  const { data: fleet } = maybeSingleResult<Fleet>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("fleets")
      .insert({
        player_id: player.id,
        name: fleetName,
        status: "active",
        current_system_id: systemId,
      })
      .select("*")
      .maybeSingle(),
  );

  if (!fleet) {
    return Response.json(
      { ok: false, error: { code: "internal_error", message: "Failed to create fleet." } },
      { status: 500 },
    );
  }

  // ── Insert fleet_ships rows ───────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("fleet_ships")
    .insert(shipIds.map((sid) => ({ fleet_id: fleet.id, ship_id: sid })));

  // ── Switch any auto-mode ships to manual ──────────────────────────────────
  const autoShipIds = foundShips
    .filter((s) => s.dispatch_mode !== "manual")
    .map((s) => s.id);
  if (autoShipIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("ships")
      .update({ dispatch_mode: "manual", auto_state: null, auto_target_colony_id: null })
      .in("id", autoShipIds);
  }

  return Response.json({
    ok: true,
    data: {
      fleetId: fleet.id,
      name: fleet.name,
      systemId,
      shipIds,
    },
  });
}
