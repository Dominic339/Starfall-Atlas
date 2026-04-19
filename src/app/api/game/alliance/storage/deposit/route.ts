/**
 * POST /api/game/alliance/storage/deposit
 *
 * Any alliance member deposits resources from their station into the
 * shared alliance storage. No credit cost — purely additive.
 *
 * Body: { resourceType: string, quantity: number }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const Schema = z.object({
  resourceType: z.string().min(1).max(40),
  quantity:     z.number().int().min(1),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { resourceType, quantity } = input.data as { resourceType: string; quantity: number };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Verify membership ─────────────────────────────────────────────────────
  const { data: membership } = maybeSingleResult<{ alliance_id: string }>(
    await admin
      .from("alliance_members")
      .select("alliance_id")
      .eq("player_id", player.id)
      .maybeSingle(),
  );
  if (!membership) {
    return toErrorResponse(fail("forbidden", "You are not in an alliance.").error);
  }

  // ── Fetch station and resource ────────────────────────────────────────────
  const { data: station } = maybeSingleResult<{ id: string }>(
    await admin.from("player_stations").select("id").eq("owner_id", player.id).maybeSingle(),
  );
  if (!station) {
    return toErrorResponse(fail("not_found", "Station not found.").error);
  }

  const { data: stationRow } = maybeSingleResult<{ quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", resourceType)
      .maybeSingle(),
  );
  const stationQty = stationRow?.quantity ?? 0;
  if (stationQty < quantity) {
    return toErrorResponse(
      fail(
        "insufficient_resources",
        `Need ${quantity} ${resourceType}, you have ${stationQty}.`,
      ).error,
    );
  }

  // ── Deduct from station ───────────────────────────────────────────────────
  const newStationQty = stationQty - quantity;
  if (newStationQty <= 0) {
    await admin
      .from("resource_inventory")
      .delete()
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", resourceType);
  } else {
    await admin
      .from("resource_inventory")
      .update({ quantity: newStationQty })
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", resourceType);
  }

  // ── Add to alliance storage ───────────────────────────────────────────────
  const { data: storageRow } = maybeSingleResult<{ quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "alliance_storage")
      .eq("location_id", membership.alliance_id)
      .eq("resource_type", resourceType)
      .maybeSingle(),
  );
  await admin
    .from("resource_inventory")
    .upsert(
      {
        location_type: "alliance_storage",
        location_id:   membership.alliance_id,
        resource_type: resourceType,
        quantity:      (storageRow?.quantity ?? 0) + quantity,
      },
      { onConflict: "location_type,location_id,resource_type" },
    );

  return Response.json({ ok: true, data: { deposited: quantity, resourceType } });
}
