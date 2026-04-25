/**
 * POST /api/game/eux/buy
 *
 * Emergency Universal Exchange — buy iron, carbon, or ice at a 5× markup
 * for immediate delivery to a colony's inventory.
 *
 * This is an anti-softlock mechanism. The high price ensures player markets
 * are always preferred for normal trade. The daily cap prevents abuse.
 *
 * Body: { colonyId, resourceType, quantity }
 * Returns: { ok: true, data: { creditsSpent, resourceType, quantity, dailyUsed } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { getBalanceWithOverrides } from "@/lib/config/balanceOverrides";

const EUX_RESOURCE_TYPES = ["iron", "carbon", "ice"] as const;

const BuySchema = z.object({
  colonyId:     z.string().uuid(),
  resourceType: z.enum(EUX_RESOURCE_TYPES),
  quantity:     z.number().int().min(1).max(500),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(BuySchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { colonyId, resourceType, quantity } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const balance = await getBalanceWithOverrides(admin);

  // ── Verify colony ownership ───────────────────────────────────────────────
  const { data: colony } = maybeSingleResult<{ id: string; owner_id: string }>(
    await admin
      .from("colonies")
      .select("id, owner_id")
      .eq("id", colonyId)
      .maybeSingle(),
  );
  if (!colony || colony.owner_id !== player.id) {
    return toErrorResponse(fail("not_found", "Colony not found.").error);
  }

  // ── Check rolling 24-hour daily limit ─────────────────────────────────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: usageRows } = await admin
    .from("universal_exchange_purchases")
    .select("quantity")
    .eq("player_id", player.id)
    .gte("purchased_at", since);

  const dailyUsed = (usageRows ?? []).reduce(
    (sum: number, r: { quantity: number }) => sum + r.quantity,
    0,
  );
  const { dailyLimitUnits } = balance.emergencyExchange;
  if (dailyUsed + quantity > dailyLimitUnits) {
    const remaining = Math.max(0, dailyLimitUnits - dailyUsed);
    return toErrorResponse(
      fail(
        "rate_limited",
        `Daily EUX limit is ${dailyLimitUnits} units. You have ${remaining} remaining today.`,
      ).error,
    );
  }

  // ── Compute price ─────────────────────────────────────────────────────────
  const { markupMultiplier, floorPricePerUnit, transactionFeePercent } = balance.emergencyExchange;
  const basePrice = (floorPricePerUnit[resourceType] ?? 5) * markupMultiplier;
  const pricePerUnit = Math.ceil(basePrice * (1 + transactionFeePercent / 100));
  const totalCost = pricePerUnit * quantity;

  // ── Check credits ─────────────────────────────────────────────────────────
  if (player.credits < totalCost) {
    return toErrorResponse(
      fail(
        "insufficient_credits",
        `Costs ${totalCost} ¢ (${pricePerUnit} ¢/unit). You have ${player.credits} ¢.`,
      ).error,
    );
  }

  // ── Deduct credits ────────────────────────────────────────────────────────
  await admin
    .from("players")
    .update({ credits: player.credits - totalCost })
    .eq("id", player.id);

  // ── Add resources to colony inventory ─────────────────────────────────────
  const { data: existing } = maybeSingleResult<{ quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "colony")
      .eq("location_id", colonyId)
      .eq("resource_type", resourceType)
      .maybeSingle(),
  );
  await admin
    .from("resource_inventory")
    .upsert(
      {
        location_type: "colony",
        location_id:   colonyId,
        resource_type: resourceType,
        quantity:      (existing?.quantity ?? 0) + quantity,
      },
      { onConflict: "location_type,location_id,resource_type" },
    );

  // ── Log purchase ──────────────────────────────────────────────────────────
  await admin.from("universal_exchange_purchases").insert({
    player_id:    player.id,
    resource_type: resourceType,
    quantity,
    credits_paid: totalCost,
    colony_id:    colonyId,
  });

  return Response.json({
    ok: true,
    data: {
      creditsSpent: totalCost,
      resourceType,
      quantity,
      dailyUsed: dailyUsed + quantity,
    },
  });
}
