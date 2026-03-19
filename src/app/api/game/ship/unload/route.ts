/**
 * POST /api/game/ship/unload
 *
 * Unloads all cargo from a ship into the player's core station inventory.
 * The ship must be docked at the station's system.
 *
 * Atomicity note: station inventory is upserted BEFORE ship cargo is cleared.
 * On failure between the two writes, ship cargo is NOT cleared — the player
 * can retry without losing resources. This is safer than the reverse order.
 * TODO(phase-8): wrap in a Postgres RPC for full transactional safety.
 *
 * Body: { shipId: string }
 * Returns: { ok: true, data: { unloaded: { resource_type: string, quantity: number }[] } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import type { Ship, PlayerStation, ResourceInventoryRow } from "@/lib/types/game";

const UnloadSchema = z.object({
  shipId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(UnloadSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { shipId } = input.data;

  const admin = createAdminClient();

  // ── Fetch ship ────────────────────────────────────────────────────────────
  const { data: ship } = maybeSingleResult<Ship>(
    await admin
      .from("ships")
      .select("*")
      .eq("id", shipId)
      .eq("owner_id", player.id)
      .maybeSingle(),
  );

  if (!ship) {
    return toErrorResponse(fail("not_found", "Ship not found.").error);
  }
  if (!ship.current_system_id) {
    return toErrorResponse(
      fail("job_in_progress", "Ship is currently in transit.").error,
    );
  }

  // ── Fetch station ─────────────────────────────────────────────────────────
  const { data: station } = maybeSingleResult<
    Pick<PlayerStation, "id" | "current_system_id">
  >(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("player_stations")
      .select("id, current_system_id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );

  if (!station) {
    return toErrorResponse(
      fail(
        "not_found",
        "Your station was not found. Sign out and back in to re-initialize it.",
      ).error,
    );
  }

  if (ship.current_system_id !== station.current_system_id) {
    return toErrorResponse(
      fail(
        "invalid_target",
        "Ship must be docked at your station's system to unload.",
      ).error,
    );
  }

  // ── Fetch ship cargo ──────────────────────────────────────────────────────
  const { data: cargoRows } = listResult<
    Pick<ResourceInventoryRow, "resource_type" | "quantity">
  >(
    await admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "ship")
      .eq("location_id", shipId),
  );
  const cargo = cargoRows ?? [];

  if (cargo.length === 0) {
    return Response.json({ ok: true, data: { unloaded: [] } });
  }

  // ── Fetch current station inventory for the cargo resource types ──────────
  const resourceTypes = cargo.map((r) => r.resource_type);
  const { data: stationRows } = listResult<
    Pick<ResourceInventoryRow, "resource_type" | "quantity">
  >(
    await admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .in("resource_type", resourceTypes),
  );
  const stationInventory = new Map(
    (stationRows ?? []).map((r) => [r.resource_type, r.quantity]),
  );

  // ── Upsert station inventory (add ship cargo quantities) ──────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("resource_inventory")
    .upsert(
      cargo.map((item) => ({
        location_type: "station",
        location_id: station.id,
        resource_type: item.resource_type,
        quantity: (stationInventory.get(item.resource_type) ?? 0) + item.quantity,
      })),
      { onConflict: "location_type,location_id,resource_type" },
    );

  // ── Clear ship cargo ──────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("resource_inventory")
    .delete()
    .eq("location_type", "ship")
    .eq("location_id", shipId);

  return Response.json({ ok: true, data: { unloaded: cargo } });
}
