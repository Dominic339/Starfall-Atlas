/**
 * POST /api/game/auction/cancel
 *
 * Cancels an active auction. Only the seller can cancel,
 * and only if no bids have been placed yet.
 *
 * Body: { auctionId: string }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const Schema = z.object({ auctionId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { auctionId } = input.data as { auctionId: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: auction } = maybeSingleResult<{
    id: string;
    seller_id: string;
    current_high_bid: number;
    status: string;
  }>(
    await admin
      .from("auctions")
      .select("id, seller_id, current_high_bid, status")
      .eq("id", auctionId)
      .maybeSingle(),
  );

  if (!auction) return toErrorResponse(fail("not_found", "Auction not found.").error);
  if (auction.seller_id !== player.id) {
    return toErrorResponse(fail("forbidden", "Only the seller can cancel this auction.").error);
  }
  if (auction.status !== "active") {
    return toErrorResponse(
      fail("invalid_target", `Auction is already ${auction.status}.`).error,
    );
  }
  if (auction.current_high_bid > 0) {
    return toErrorResponse(
      fail("forbidden", "Cannot cancel an auction that already has bids.").error,
    );
  }

  await admin
    .from("auctions")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("id", auctionId);

  return Response.json({ ok: true, data: { auctionId } });
}
