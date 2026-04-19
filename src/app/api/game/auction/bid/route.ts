/**
 * POST /api/game/auction/bid
 *
 * Places a bid on an active auction.
 *
 * Body: { auctionId: string, amount: number }
 *
 * Rules:
 *   - Auction must be active and ends_at > now
 *   - Bidder cannot be the seller
 *   - amount >= max(min_bid, current_high_bid + 1)
 *   - Bidder must have sufficient credits
 *   - Anti-snipe: bid placed within antiSnipeWindowMinutes of ends_at extends by antiSnipeExtensionMinutes
 *   - Previous high bidder is refunded
 *
 * Returns: { bidId, newEndTime, extended }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";

const Schema = z.object({
  auctionId: z.string().uuid(),
  amount: z.number().int().min(1),
});

type AuctionRow = {
  id: string;
  seller_id: string;
  item_type: string;
  item_id: string;
  min_bid: number;
  current_high_bid: number;
  high_bidder_id: string | null;
  ends_at: string;
  status: string;
};

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { auctionId, amount } = input.data as { auctionId: string; amount: number };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();

  // ── Fetch and validate auction ────────────────────────────────────────────
  const { data: auction } = maybeSingleResult<AuctionRow>(
    await admin.from("auctions").select("*").eq("id", auctionId).maybeSingle(),
  );

  if (!auction) return toErrorResponse(fail("not_found", "Auction not found.").error);
  if (auction.status !== "active") {
    return toErrorResponse(fail("invalid_target", "Auction is not active.").error);
  }
  if (new Date(auction.ends_at) <= now) {
    return toErrorResponse(fail("invalid_target", "Auction has already ended.").error);
  }
  if (auction.seller_id === player.id) {
    return toErrorResponse(fail("forbidden", "You cannot bid on your own auction.").error);
  }

  const minRequired = Math.max(auction.min_bid, auction.current_high_bid + 1);
  if (amount < minRequired) {
    return toErrorResponse(
      fail("validation_error", `Bid must be at least ${minRequired} ¢.`).error,
    );
  }
  if (player.credits < amount) {
    return toErrorResponse(
      fail("insufficient_credits", `Need ${amount} ¢ but you have ${player.credits} ¢.`).error,
    );
  }

  // ── Deduct credits from new bidder (escrow) ───────────────────────────────
  await admin
    .from("players")
    .update({ credits: player.credits - amount })
    .eq("id", player.id);

  // ── Refund previous high bidder ───────────────────────────────────────────
  if (auction.high_bidder_id && auction.current_high_bid > 0) {
    const { data: prevBidder } = await admin
      .from("players")
      .select("credits")
      .eq("id", auction.high_bidder_id)
      .maybeSingle();

    if (prevBidder) {
      await admin
        .from("players")
        .update({
          credits: (prevBidder as { credits: number }).credits + auction.current_high_bid,
        })
        .eq("id", auction.high_bidder_id);
    }

    await admin
      .from("auction_bids")
      .update({ escrow_held: false })
      .eq("auction_id", auctionId)
      .eq("bidder_id", auction.high_bidder_id)
      .eq("escrow_held", true);
  }

  // ── Anti-snipe: extend ends_at if bid placed near the deadline ────────────
  const windowMs    = BALANCE.auctions.antiSnipeWindowMinutes * 60_000;
  const extensionMs = BALANCE.auctions.antiSnipeExtensionMinutes * 60_000;
  const endsAt      = new Date(auction.ends_at);
  const extended    = endsAt.getTime() - now.getTime() <= windowMs;
  const newEndsAt   = extended ? new Date(now.getTime() + extensionMs) : endsAt;

  // ── Update auction ────────────────────────────────────────────────────────
  await admin
    .from("auctions")
    .update({
      current_high_bid: amount,
      high_bidder_id: player.id,
      ends_at: newEndsAt.toISOString(),
    })
    .eq("id", auctionId);

  // ── Record bid ────────────────────────────────────────────────────────────
  const { data: bidRow } = await admin
    .from("auction_bids")
    .insert({ auction_id: auctionId, bidder_id: player.id, amount, escrow_held: true })
    .select("id")
    .single();

  return Response.json({
    ok: true,
    data: {
      bidId:      (bidRow as { id: string }).id,
      newEndTime: newEndsAt.toISOString(),
      extended,
    },
  });
}
