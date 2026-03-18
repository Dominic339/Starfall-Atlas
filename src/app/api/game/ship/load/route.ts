/**
 * POST /api/game/ship/load
 *
 * Loads resources from a colony's inventory into a ship's cargo.
 * The ship must be docked at the colony's system.
 *
 * If quantity exceeds available colony stock, loads whatever is available.
 * If quantity exceeds remaining ship cargo capacity, loads only what fits.
 *
 * Body: { shipId: string, colonyId: string, resourceType: string, quantity: number }
 * Returns: { ok: true, data: { loaded: number, shipCargoUsed: number } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import type { Ship, Colony, ResourceInventoryRow } from "@/lib/types/game";

const LoadSchema = z.object({
  shipId: z.string().uuid(),
  colonyId: z.string().uuid(),
  resourceType: z.string().min(1).max(64),
  quantity: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(LoadSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { shipId, colonyId, resourceType, quantity } = input.data;

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

  // ── Fetch colony ──────────────────────────────────────────────────────────
  type ColonyRow = Pick<Colony, "id" | "owner_id" | "system_id" | "status">;
  const { data: colony } = maybeSingleResult<ColonyRow>(
    await admin
      .from("colonies")
      .select("id, owner_id, system_id, status")
      .eq("id", colonyId)
      .maybeSingle(),
  );

  if (!colony) {
    return toErrorResponse(fail("not_found", "Colony not found.").error);
  }
  if (colony.owner_id !== player.id) {
    return toErrorResponse(
      fail("forbidden", "You do not own this colony.").error,
    );
  }
  if (colony.status !== "active") {
    return toErrorResponse(
      fail("invalid_target", "Colony is not active.").error,
    );
  }
  if (colony.system_id !== ship.current_system_id) {
    return toErrorResponse(
      fail(
        "invalid_target",
        "Ship must be in the colony's system to load cargo.",
      ).error,
    );
  }

  // ── Check colony inventory ────────────────────────────────────────────────
  const { data: colonyRow } = maybeSingleResult<
    Pick<ResourceInventoryRow, "quantity">
  >(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "colony")
      .eq("location_id", colonyId)
      .eq("resource_type", resourceType)
      .maybeSingle(),
  );

  const available = colonyRow?.quantity ?? 0;
  if (available === 0) {
    return toErrorResponse(
      fail(
        "not_found",
        `No ${resourceType} available in colony inventory.`,
      ).error,
    );
  }

  // ── Check ship cargo capacity ─────────────────────────────────────────────
  const { data: cargoRows } = listResult<Pick<ResourceInventoryRow, "quantity">>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "ship")
      .eq("location_id", shipId),
  );
  const currentCargoUsed = (cargoRows ?? []).reduce((s, r) => s + r.quantity, 0);
  const freeCapacity = ship.cargo_cap - currentCargoUsed;

  if (freeCapacity <= 0) {
    return toErrorResponse(
      fail("invalid_target", "Ship cargo is full.").error,
    );
  }

  // Load min(requested, available, freeCapacity)
  const actualLoad = Math.min(quantity, available, freeCapacity);

  // ── Deduct from colony inventory ──────────────────────────────────────────
  const newColonyQty = available - actualLoad;
  if (newColonyQty === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("resource_inventory")
      .delete()
      .eq("location_type", "colony")
      .eq("location_id", colonyId)
      .eq("resource_type", resourceType);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("resource_inventory")
      .update({ quantity: newColonyQty })
      .eq("location_type", "colony")
      .eq("location_id", colonyId)
      .eq("resource_type", resourceType);
  }

  // ── Add to ship cargo (upsert) ────────────────────────────────────────────
  const { data: shipCargoRow } = maybeSingleResult<
    Pick<ResourceInventoryRow, "quantity">
  >(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "ship")
      .eq("location_id", shipId)
      .eq("resource_type", resourceType)
      .maybeSingle(),
  );
  const newShipQty = (shipCargoRow?.quantity ?? 0) + actualLoad;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("resource_inventory")
    .upsert(
      {
        location_type: "ship",
        location_id: shipId,
        resource_type: resourceType,
        quantity: newShipQty,
      },
      { onConflict: "location_type,location_id,resource_type" },
    );

  return Response.json({
    ok: true,
    data: { loaded: actualLoad, shipCargoUsed: currentCargoUsed + actualLoad },
  });
}
