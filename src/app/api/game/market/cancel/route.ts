/**
 * POST /api/game/market/cancel
 *
 * Cancels an open (or partially filled) sell listing owned by the caller.
 * Returns the unsold portion of resources to the seller's station inventory.
 * The listing fee is not refunded.
 *
 * Body: { listingId }
 * Returns: { ok: true, data: { resourceType, quantityReturned } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const CancelSchema = z.object({
  listingId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(CancelSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { listingId } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Fetch listing ─────────────────────────────────────────────────────────
  const { data: listing } = maybeSingleResult<{
    id: string;
    seller_id: string;
    resource_type: string;
    quantity: number;
    quantity_filled: number;
    status: string;
  }>(
    await admin
      .from("market_listings")
      .select("id, seller_id, resource_type, quantity, quantity_filled, status")
      .eq("id", listingId)
      .maybeSingle(),
  );

  if (!listing) {
    return toErrorResponse(fail("not_found", "Listing not found.").error);
  }
  if (listing.seller_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You can only cancel your own listings.").error);
  }
  if (listing.status !== "open" && listing.status !== "partially_filled") {
    return toErrorResponse(fail("invalid_target", "This listing cannot be cancelled.").error);
  }

  const toReturn = listing.quantity - listing.quantity_filled;

  // ── Fetch seller's station ────────────────────────────────────────────────
  const { data: station } = maybeSingleResult<{ id: string }>(
    await admin
      .from("player_stations")
      .select("id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );
  if (!station) {
    return toErrorResponse(fail("not_found", "Station not found.").error);
  }

  // ── Return resources to station ───────────────────────────────────────────
  if (toReturn > 0) {
    const { data: invRow } = maybeSingleResult<{ quantity: number }>(
      await admin
        .from("resource_inventory")
        .select("quantity")
        .eq("location_type", "station")
        .eq("location_id", station.id)
        .eq("resource_type", listing.resource_type)
        .maybeSingle(),
    );
    await admin
      .from("resource_inventory")
      .upsert(
        {
          location_type: "station",
          location_id:   station.id,
          resource_type: listing.resource_type,
          quantity:      (invRow?.quantity ?? 0) + toReturn,
        },
        { onConflict: "location_type,location_id,resource_type" },
      );
  }

  // ── Mark listing as cancelled ─────────────────────────────────────────────
  await admin
    .from("market_listings")
    .update({ status: "cancelled" })
    .eq("id", listingId);

  return Response.json({
    ok: true,
    data: { resourceType: listing.resource_type, quantityReturned: toReturn },
  });
}
