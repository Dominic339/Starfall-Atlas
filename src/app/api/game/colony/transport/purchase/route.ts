/**
 * POST /api/game/colony/transport/purchase
 *
 * Purchases a new tier-1 colony transport unit for a player-owned colony.
 * Cost is deducted from the player's station inventory.
 *
 * Body:   { colonyId: string }
 * Returns: { ok: true, data: { transportId: string, tier: number, totalCapacity: number } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";
import { colonyTransportCapacity } from "@/lib/game/transportCapacity";
import type { Colony, PlayerStation } from "@/lib/types/game";

const PurchaseTransportSchema = z.object({
  colonyId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(PurchaseTransportSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { colonyId } = input.data;

  const admin = createAdminClient();

  // ── Verify colony ownership and status ───────────────────────────────────
  const { data: colony } = maybeSingleResult<Pick<Colony, "id" | "owner_id" | "status">>(
    await admin
      .from("colonies")
      .select("id, owner_id, status")
      .eq("id", colonyId)
      .maybeSingle(),
  );

  if (!colony) {
    return toErrorResponse(fail("not_found", "Colony not found.").error);
  }
  if (colony.owner_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You do not own this colony.").error);
  }
  if (colony.status !== "active") {
    return toErrorResponse(
      fail("invalid_target", "Colony must be active to purchase transports.").error,
    );
  }

  // ── Fetch player station ──────────────────────────────────────────────────
  const { data: station } = maybeSingleResult<PlayerStation>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("player_stations")
      .select("id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );

  if (!station) {
    return toErrorResponse(fail("not_found", "Station not found — refresh the page to rebuild it automatically.").error);
  }

  // ── Check station iron balance ────────────────────────────────────────────
  const cost = BALANCE.colonyTransport.purchaseCostIron;

  const { data: ironRow } = maybeSingleResult<{ quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron")
      .maybeSingle(),
  );

  const ironAvailable = ironRow?.quantity ?? 0;
  if (ironAvailable < cost) {
    return toErrorResponse(
      fail(
        "insufficient_resources",
        `Not enough iron. Need ${cost}, have ${ironAvailable}.`,
      ).error,
    );
  }

  // ── Deduct iron from station ──────────────────────────────────────────────
  const newIron = ironAvailable - cost;

  if (newIron <= 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("resource_inventory")
      .delete()
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron");
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("resource_inventory")
      .update({ quantity: newIron })
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron");
  }

  // ── Insert transport row ──────────────────────────────────────────────────
  const { data: inserted } = maybeSingleResult<{ id: string }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("colony_transports")
      .insert({ colony_id: colonyId, tier: 1 })
      .select("id")
      .maybeSingle(),
  );

  if (!inserted) {
    return toErrorResponse(fail("internal_error", "Failed to create transport.").error);
  }

  // ── Return updated capacity ───────────────────────────────────────────────
  const { data: allTransports } = listResult<{ tier: number }>(
    await admin
      .from("colony_transports")
      .select("tier")
      .eq("colony_id", colonyId),
  );

  const totalCapacity = colonyTransportCapacity(allTransports ?? []);

  return Response.json({
    ok: true,
    data: {
      transportId: inserted.id,
      tier: 1,
      totalCapacity,
      count: (allTransports ?? []).length,
    },
  });
}
