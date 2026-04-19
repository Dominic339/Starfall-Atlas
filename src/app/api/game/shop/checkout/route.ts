/**
 * POST /api/game/shop/checkout
 *
 * Creates a Stripe Checkout session for purchasing a premium item.
 * When STRIPE_SECRET_KEY is absent (dev mode) the item is granted immediately
 * without going through Stripe, so the shop is testable locally.
 *
 * Body: { itemType: PremiumItemType }
 * Returns: { ok: true, data: { url: string } }  — redirect to Stripe (or to /game/shop?success=1 in dev)
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { SHOP_CATALOG } from "@/lib/config/shop";
import { BALANCE } from "@/lib/config/balance";
import type { PremiumItemType } from "@/lib/types/enums";

const Schema = z.object({
  itemType: z.string().min(1) as z.ZodType<PremiumItemType>,
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { itemType } = input.data;

  const item = SHOP_CATALOG.find((i) => i.type === itemType);
  if (!item) {
    return toErrorResponse(fail("not_found", "Unknown shop item.").error);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Colony permit: enforce lifetime cap ───────────────────────────────────
  if (itemType === "colony_permit") {
    const { count } = await admin
      .from("premium_entitlements")
      .select("id", { count: "exact", head: true })
      .eq("player_id", player.id)
      .eq("item_type", "colony_permit");
    if ((count ?? 0) >= BALANCE.premium.maxColonyPermitsPerAccount) {
      return toErrorResponse(
        fail(
          "colony_limit_reached",
          `Colony Permit limit reached (max ${BALANCE.premium.maxColonyPermitsPerAccount} per account).`,
        ).error,
      );
    }
  }

  // ── Alliance emblem / discoverer monument: enforce non-stackable cap ──────
  if (!item.stackable) {
    const { count } = await admin
      .from("premium_entitlements")
      .select("id", { count: "exact", head: true })
      .eq("player_id", player.id)
      .eq("item_type", itemType)
      .eq("consumed", false);
    if ((count ?? 0) > 0) {
      return toErrorResponse(
        fail("already_exists", `You already have an unused ${item.name}.`).error,
      );
    }
  }

  const origin = request.headers.get("origin") ?? "http://localhost:3000";
  const successUrl = `${origin}/game/shop?success=1&item=${encodeURIComponent(item.name)}`;
  const cancelUrl  = `${origin}/game/shop?cancelled=1`;

  // ── Dev mode: no Stripe key → grant immediately ───────────────────────────
  if (!process.env.STRIPE_SECRET_KEY) {
    await admin.from("premium_entitlements").insert({
      player_id:    player.id,
      item_type:    itemType,
      item_config:  {},
      consumed:     false,
      purchase_ref: "dev_mode",
    });
    return Response.json({ ok: true, data: { url: successUrl } });
  }

  // ── Production: create Stripe Checkout session ────────────────────────────
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
  });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: item.priceCents,
          product_data: { name: item.name, description: item.description },
        },
        quantity: 1,
      },
    ],
    metadata: {
      player_id: player.id,
      item_type:  itemType,
    },
    success_url: successUrl,
    cancel_url:  cancelUrl,
  });

  return Response.json({ ok: true, data: { url: session.url } });
}
