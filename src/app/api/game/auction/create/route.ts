/**
 * POST /api/game/auction/create
 *
 * Creates an auction for a colony or stewardship rights.
 *
 * Body: {
 *   itemType: "colony" | "stewardship"
 *   itemId: string         — colonyId or systemId
 *   minBid: number         — minimum first bid in credits (≥ 0)
 *   durationHours: number  — auction length (1..168)
 * }
 *
 * Rules:
 *   colony     — caller must own it; status must be 'active'; no active auction for it
 *   stewardship — caller must be current steward; no active auction for it
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";

const MIN_H = BALANCE.auctions.minDurationHours;
const MAX_H = BALANCE.auctions.maxDurationDays * 24;

const Schema = z.object({
  itemType: z.enum(["colony", "stewardship"]),
  itemId: z.string().uuid(),
  minBid: z.number().int().min(0),
  durationHours: z.number().int().min(MIN_H).max(MAX_H),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { itemType, itemId, minBid, durationHours } = input.data as {
    itemType: "colony" | "stewardship";
    itemId: string;
    minBid: number;
    durationHours: number;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Guard: no existing active auction for this item ───────────────────────
  const { data: existing } = listResult<{ id: string }>(
    await admin.from("auctions").select("id").eq("item_id", itemId).eq("status", "active"),
  );
  if (existing && existing.length > 0) {
    return toErrorResponse(
      fail("already_auctioned", "An active auction already exists for this item.").error,
    );
  }

  // ── Verify ownership and eligibility ─────────────────────────────────────
  let systemId: string | null = null;

  if (itemType === "colony") {
    const { data: colony } = maybeSingleResult<{
      id: string;
      status: string;
      system_id: string;
    }>(
      await admin
        .from("colonies")
        .select("id, status, system_id")
        .eq("id", itemId)
        .eq("owner_id", player.id)
        .maybeSingle(),
    );
    if (!colony) {
      return toErrorResponse(fail("not_found", "Colony not found or not owned by you.").error);
    }
    if (colony.status !== "active") {
      return toErrorResponse(
        fail("invalid_target", "Only active colonies can be auctioned.").error,
      );
    }
    systemId = colony.system_id;
  } else {
    const { data: stewardship } = maybeSingleResult<{ system_id: string }>(
      await admin
        .from("system_stewardship")
        .select("system_id")
        .eq("system_id", itemId)
        .eq("steward_id", player.id)
        .maybeSingle(),
    );
    if (!stewardship) {
      return toErrorResponse(
        fail("not_found", "Stewardship not found or not held by you.").error,
      );
    }
    systemId = itemId;
  }

  // ── Insert auction ────────────────────────────────────────────────────────
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationHours * 3_600_000).toISOString();

  const { data: auctionRow } = await admin
    .from("auctions")
    .insert({
      seller_id: player.id,
      item_type: itemType,
      item_id: itemId,
      min_bid: minBid,
      current_high_bid: 0,
      high_bidder_id: null,
      starts_at: now.toISOString(),
      ends_at: endsAt,
      status: "active",
    })
    .select("id")
    .single();

  await admin.from("world_events").insert({
    event_type: "auction_started",
    player_id: player.id,
    system_id: systemId,
    body_id: null,
    metadata: {
      auction_id: (auctionRow as { id: string }).id,
      item_type: itemType,
      item_id: itemId,
      min_bid: minBid,
    },
  });

  return Response.json({
    ok: true,
    data: { auctionId: (auctionRow as { id: string }).id, endsAt },
  });
}
