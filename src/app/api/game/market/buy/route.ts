/**
 * POST /api/game/market/buy
 *
 * Purchases units from an open sell listing.
 * Credits deducted from buyer; added to seller.
 * Resources delivered instantly to buyer's station inventory.
 * The listing fee was already paid by the seller at creation and is not
 * deducted again here — seller receives full pricePerUnit × qty.
 *
 * Body: { listingId, quantity? }  (quantity defaults to remaining unfilled qty)
 * Returns: { ok: true, data: { creditsSpent, resourceType, quantityReceived } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { awardBattlePassXp } from "@/lib/game/battlePass";

const BuySchema = z.object({
  listingId: z.string().uuid(),
  quantity:  z.number().int().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(BuySchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { listingId, quantity: requestedQty } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Fetch listing ─────────────────────────────────────────────────────────
  const { data: listing } = maybeSingleResult<{
    id: string;
    seller_id: string;
    side: string;
    resource_type: string;
    quantity: number;
    quantity_filled: number;
    price_per_unit: number;
    status: string;
  }>(
    await admin
      .from("market_listings")
      .select("id, seller_id, side, resource_type, quantity, quantity_filled, price_per_unit, status")
      .eq("id", listingId)
      .maybeSingle(),
  );

  if (!listing) {
    return toErrorResponse(fail("not_found", "Listing not found.").error);
  }
  if (listing.status !== "open" && listing.status !== "partially_filled") {
    return toErrorResponse(fail("invalid_target", "This listing is no longer available.").error);
  }
  if (listing.side !== "sell") {
    return toErrorResponse(fail("invalid_target", "Only sell orders can be bought directly.").error);
  }
  if (listing.seller_id === player.id) {
    return toErrorResponse(fail("forbidden", "You cannot buy your own listing.").error);
  }

  const remaining = listing.quantity - listing.quantity_filled;
  const qty = Math.min(requestedQty ?? remaining, remaining);
  if (qty <= 0) {
    return toErrorResponse(fail("invalid_target", "No quantity available.").error);
  }

  const totalCost = qty * listing.price_per_unit;

  // ── Check buyer credits ───────────────────────────────────────────────────
  if (player.credits < totalCost) {
    return toErrorResponse(
      fail("insufficient_credits", `Costs ${totalCost} ¢. You have ${player.credits} ¢.`).error,
    );
  }

  // ── Fetch buyer's station ─────────────────────────────────────────────────
  const { data: buyerStation } = maybeSingleResult<{ id: string }>(
    await admin
      .from("player_stations")
      .select("id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );
  if (!buyerStation) {
    return toErrorResponse(fail("not_found", "Your station was not found.").error);
  }

  // ── Fetch seller's current credits for the update ─────────────────────────
  const { data: seller } = maybeSingleResult<{ credits: number }>(
    await admin
      .from("players")
      .select("credits")
      .eq("id", listing.seller_id)
      .maybeSingle(),
  );
  const sellerCredits = seller?.credits ?? 0;

  // ── Deduct credits from buyer ──────────────────────────────────────────────
  await admin
    .from("players")
    .update({ credits: player.credits - totalCost })
    .eq("id", player.id);

  // ── Add credits to seller ──────────────────────────────────────────────────
  await admin
    .from("players")
    .update({ credits: sellerCredits + totalCost })
    .eq("id", listing.seller_id);

  // ── Deliver resources to buyer's station ──────────────────────────────────
  const { data: buyerInv } = maybeSingleResult<{ quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", buyerStation.id)
      .eq("resource_type", listing.resource_type)
      .maybeSingle(),
  );
  await admin
    .from("resource_inventory")
    .upsert(
      {
        location_type: "station",
        location_id:   buyerStation.id,
        resource_type: listing.resource_type,
        quantity:      (buyerInv?.quantity ?? 0) + qty,
      },
      { onConflict: "location_type,location_id,resource_type" },
    );

  // ── Update listing status ─────────────────────────────────────────────────
  const newFilled = listing.quantity_filled + qty;
  const newStatus = newFilled >= listing.quantity ? "filled" : "partially_filled";
  await admin
    .from("market_listings")
    .update({ quantity_filled: newFilled, status: newStatus, buyer_id: player.id })
    .eq("id", listingId);

  // Award battle pass XP for market trade (fire-and-forget)
  void awardBattlePassXp(admin, player.id, { type: "market_trades", count: 1 });

  return Response.json({
    ok: true,
    data: {
      creditsSpent:      totalCost,
      resourceType:      listing.resource_type,
      quantityReceived:  qty,
    },
  });
}
