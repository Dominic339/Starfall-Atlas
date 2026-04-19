/**
 * POST /api/game/market/list
 *
 * Creates a sell listing on the global market.
 * Resources are immediately removed from the seller's station inventory.
 * A 2% listing fee is deducted from the seller's credits at creation.
 *
 * Body: { resourceType, quantity, pricePerUnit }
 * Returns: { ok: true, data: { listingId } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";

const VALID_RESOURCE_TYPES = [
  "iron", "carbon", "silica", "sulfur", "water", "biomass",
  "rare_crystal", "food", "steel", "glass",
  "exotic_matter", "crystalline_core", "void_dust",
] as const;

const ListSchema = z.object({
  resourceType: z.enum(VALID_RESOURCE_TYPES),
  quantity:     z.number().int().min(1).max(1_000_000),
  pricePerUnit: z.number().int().min(1).max(1_000_000),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(ListSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { resourceType, quantity, pricePerUnit } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Fetch player station ───────────────────────────────────────────────────
  const { data: station } = maybeSingleResult<{ id: string; current_system_id: string }>(
    await admin
      .from("player_stations")
      .select("id, current_system_id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );
  if (!station) {
    return toErrorResponse(fail("not_found", "Station not found.").error);
  }

  // ── Check station inventory ────────────────────────────────────────────────
  const { data: invRow } = maybeSingleResult<{ quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", resourceType)
      .maybeSingle(),
  );
  const available = invRow?.quantity ?? 0;
  if (available < quantity) {
    return toErrorResponse(
      fail("insufficient_resources", `Not enough ${resourceType}. Have ${available}, need ${quantity}.`).error,
    );
  }

  // ── Compute and check listing fee ─────────────────────────────────────────
  const listingFee = Math.floor(quantity * pricePerUnit * (BALANCE.market.listingFeePercent / 100));
  if (player.credits < listingFee) {
    return toErrorResponse(
      fail("insufficient_credits", `Listing fee is ${listingFee} ¢. You have ${player.credits} ¢.`).error,
    );
  }

  // ── Deduct resources from station ─────────────────────────────────────────
  await admin
    .from("resource_inventory")
    .update({ quantity: available - quantity })
    .eq("location_type", "station")
    .eq("location_id", station.id)
    .eq("resource_type", resourceType);

  // ── Deduct listing fee from credits ────────────────────────────────────────
  if (listingFee > 0) {
    await admin
      .from("players")
      .update({ credits: player.credits - listingFee })
      .eq("id", player.id);
  }

  // ── Create listing ────────────────────────────────────────────────────────
  const expiresAt = new Date(Date.now() + BALANCE.market.defaultExpiryDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: listing } = maybeSingleResult<{ id: string }>(
    await admin
      .from("market_listings")
      .insert({
        region_id:        "global",
        seller_id:        player.id,
        buyer_id:         null,
        side:             "sell",
        resource_type:    resourceType,
        quantity:         quantity,
        quantity_filled:  0,
        price_per_unit:   pricePerUnit,
        listing_fee_paid: listingFee,
        escrow_held:      0,
        system_id:        station.current_system_id,
        status:           "open",
        expires_at:       expiresAt,
      })
      .select("id")
      .single(),
  );

  return Response.json({ ok: true, data: { listingId: listing?.id ?? null } });
}
