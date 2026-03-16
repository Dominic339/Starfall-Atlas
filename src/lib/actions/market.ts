/**
 * Market action: post a sell listing or buy order.
 *
 * Implementation status: structure + validation complete.
 * DB transaction (escrow, matching) is TODO(phase-8).
 */

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, parseInput } from "./helpers";
import { ok, fail, type ActionResult } from "./types";
import { BALANCE } from "@/lib/config/balance";
import type { PostListingResult } from "@/lib/types/api";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const postListingSchema = z.object({
  regionId: z.string().min(1),
  side: z.enum(["sell", "buy"]),
  resourceType: z.string().min(1),
  quantity: z.number().int().positive(),
  pricePerUnit: z.number().int().positive(),
  systemId: z.string().min(1),
  expiryDays: z.number().int().min(1).max(30).default(
    BALANCE.market.defaultExpiryDays,
  ),
});

// ---------------------------------------------------------------------------
// Listing fee calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the listing fee (burned on creation).
 * Fee = 2% of total listing value, rounded down.
 */
export function calculateListingFee(quantity: number, pricePerUnit: number): number {
  const totalValue = quantity * pricePerUnit;
  return Math.floor((totalValue * BALANCE.market.listingFeePercent) / 100);
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/**
 * Post a market listing (sell or buy order).
 *
 * Preconditions:
 * - Player authenticated.
 * - Input valid.
 * - Player has sufficient credits for fee (sell) or total cost + fee (buy).
 *
 * TODO(phase-8): Implement inside a transaction:
 *   a. Deduct listing fee from player.credits.
 *   b. For buy orders: hold (quantity * pricePerUnit) in escrow.
 *   c. Insert market_listings row.
 *   d. Attempt immediate match against existing open orders.
 *   e. If matched: transfer resources/credits, insert market_trades row.
 */
export async function postListing(
  rawInput: unknown,
): Promise<ActionResult<PostListingResult>> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;
  const { player } = authResult.data;

  const inputResult = parseInput(postListingSchema, rawInput);
  if (!inputResult.ok) return inputResult;
  const input = inputResult.data;

  const fee = calculateListingFee(input.quantity, input.pricePerUnit);
  const escrowRequired =
    input.side === "buy" ? input.quantity * input.pricePerUnit : 0;
  const totalCreditsRequired = fee + escrowRequired;

  if (player.credits < totalCreditsRequired) {
    return fail(
      "insufficient_credits",
      `Insufficient credits. Need ${totalCreditsRequired} (fee: ${fee}, escrow: ${escrowRequired}), have ${player.credits}.`,
    );
  }

  // TODO(phase-8): Execute in transaction.
  return fail(
    "not_implemented",
    "Market listing not yet implemented. Coming in Phase 8.",
  );
}
