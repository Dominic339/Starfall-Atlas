/**
 * POST /api/game/alliance/storage/withdraw
 *
 * Alliance member spends alliance_credits to withdraw resources from shared
 * storage into their own station. Rate: 1 credit per resource unit.
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

  // ── Verify membership and credit balance ──────────────────────────────────
  const { data: membership } = maybeSingleResult<{
    id: string;
    alliance_id: string;
    alliance_credits: number;
  }>(
    await admin
      .from("alliance_members")
      .select("id, alliance_id, alliance_credits")
      .eq("player_id", player.id)
      .maybeSingle(),
  );
  if (!membership) {
    return toErrorResponse(fail("forbidden", "You are not in an alliance.").error);
  }
  if (membership.alliance_credits < quantity) {
    return toErrorResponse(
      fail(
        "insufficient_credits",
        `Need ${quantity} alliance credits, you have ${membership.alliance_credits}.`,
      ).error,
    );
  }

  // ── Check alliance storage ────────────────────────────────────────────────
  const { data: storageRow } = maybeSingleResult<{ quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "alliance_storage")
      .eq("location_id", membership.alliance_id)
      .eq("resource_type", resourceType)
      .maybeSingle(),
  );
  const storageQty = storageRow?.quantity ?? 0;
  if (storageQty < quantity) {
    return toErrorResponse(
      fail(
        "insufficient_resources",
        `Alliance storage has ${storageQty} ${resourceType}, need ${quantity}.`,
      ).error,
    );
  }

  // ── Deduct from alliance storage ──────────────────────────────────────────
  const newStorageQty = storageQty - quantity;
  if (newStorageQty <= 0) {
    await admin
      .from("resource_inventory")
      .delete()
      .eq("location_type", "alliance_storage")
      .eq("location_id", membership.alliance_id)
      .eq("resource_type", resourceType);
  } else {
    await admin
      .from("resource_inventory")
      .update({ quantity: newStorageQty })
      .eq("location_type", "alliance_storage")
      .eq("location_id", membership.alliance_id)
      .eq("resource_type", resourceType);
  }

  // ── Add to player station ─────────────────────────────────────────────────
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
  await admin
    .from("resource_inventory")
    .upsert(
      {
        location_type: "station",
        location_id:   station.id,
        resource_type: resourceType,
        quantity:      (stationRow?.quantity ?? 0) + quantity,
      },
      { onConflict: "location_type,location_id,resource_type" },
    );

  // ── Deduct alliance credits ───────────────────────────────────────────────
  await admin
    .from("alliance_members")
    .update({ alliance_credits: membership.alliance_credits - quantity })
    .eq("id", membership.id);

  return Response.json({ ok: true, data: { withdrawn: quantity, resourceType, creditsSpent: quantity } });
}
