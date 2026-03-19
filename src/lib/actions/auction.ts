/**
 * Auction actions: create auction, place bid.
 *
 * Implementation status: structure + validation complete.
 * DB transaction (escrow, anti-snipe, resolution) is TODO(phase-9).
 */

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, parseInput } from "./helpers";
import { ok, fail, type ActionResult } from "./types";
import { BALANCE } from "@/lib/config/balance";
import type { PlaceBidResult } from "@/lib/types/api";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createAuctionSchema = z.object({
  itemType: z.enum(["colony", "stewardship", "ship", "item"]),
  itemId: z.string().min(1),
  minBid: z.number().int().min(0),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

const placeBidSchema = z.object({
  auctionId: z.string().uuid(),
  amount: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Create an auction for an owned item.
 *
 * TODO(phase-9): Verify ownership of itemId, insert auction row.
 */
export async function createAuction(rawInput: unknown): Promise<ActionResult<{ auctionId: string }>> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;

  const inputResult = parseInput(createAuctionSchema, rawInput);
  if (!inputResult.ok) return inputResult;
  const input = inputResult.data;

  const starts = new Date(input.startsAt);
  const ends = new Date(input.endsAt);

  if (ends <= starts) {
    return fail("validation_error", "ends_at must be after starts_at.");
  }

  // TODO(phase-9): Implement ownership check and auction creation.
  return fail("not_implemented", "Auction creation not yet implemented. Coming in Phase 9.");
}

/**
 * Place a bid on an active auction.
 *
 * Anti-snipe rule (GAME_RULES.md §10):
 * - If placed within 5 minutes of ends_at, extend ends_at by 5 minutes.
 *
 * TODO(phase-9): Execute in transaction with SELECT FOR UPDATE on auction row.
 */
export async function placeBid(rawInput: unknown): Promise<ActionResult<PlaceBidResult>> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;
  const { player } = authResult.data;

  const inputResult = parseInput(placeBidSchema, rawInput);
  if (!inputResult.ok) return inputResult;
  const { auctionId, amount } = inputResult.data;

  const admin = createAdminClient();

  // Explicit type needed: untyped admin client infers data as never without it
  type AuctionRow = {
    id: string;
    status: string;
    ends_at: string;
    current_high_bid: number;
    min_bid: number;
    seller_id: string;
  };
  const { data: auctionData, error } = await admin
    .from("auctions")
    .select("id, status, ends_at, current_high_bid, min_bid, seller_id")
    .eq("id", auctionId)
    .single() as unknown as { data: AuctionRow | null; error: unknown };
  const auction = auctionData;

  if (error || !auction) return fail("not_found", "Auction not found.");
  if (auction.status !== "active") return fail("invalid_target", "Auction is not active.");
  if (auction.seller_id === player.id) return fail("forbidden", "You cannot bid on your own auction.");
  if (new Date(auction.ends_at) <= new Date()) return fail("invalid_target", "Auction has ended.");

  const minimumBid = Math.max(auction.min_bid, auction.current_high_bid + 1);
  if (amount < minimumBid) {
    return fail("validation_error", `Bid must be at least ${minimumBid} credits.`);
  }

  if (player.credits < amount) {
    return fail("insufficient_credits", `Insufficient credits to place bid of ${amount}.`);
  }

  // Anti-snipe window check
  const windowMs = BALANCE.auctions.antiSnipeWindowMinutes * 60 * 1000;
  const endsAt = new Date(auction.ends_at);
  const willExtend = endsAt.getTime() - Date.now() <= windowMs;
  const newEndsAt = willExtend
    ? new Date(endsAt.getTime() + BALANCE.auctions.antiSnipeExtensionMinutes * 60 * 1000)
    : endsAt;

  // TODO(phase-9): Execute bid + escrow + anti-snipe extension in transaction.
  return fail("not_implemented", "Bid placement not yet implemented. Coming in Phase 9.");
}
