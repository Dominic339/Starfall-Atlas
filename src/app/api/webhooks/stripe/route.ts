/**
 * POST /api/webhooks/stripe
 *
 * Handles Stripe webhook events. Verifies the signature and, on
 * checkout.session.completed, inserts a premium_entitlements row for the
 * purchasing player.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY        — Stripe secret key
 *   STRIPE_WEBHOOK_SECRET    — from `stripe listen --forward-to ...` or dashboard
 */

import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PremiumItemType } from "@/lib/types/enums";
import { SHOP_CATALOG } from "@/lib/config/shop";

export async function POST(request: NextRequest) {
  const stripeSecret  = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecret || !webhookSecret) {
    return new Response("Stripe not configured.", { status: 503 });
  }

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

  const sig  = request.headers.get("stripe-signature") ?? "";
  const body = await request.text();

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return new Response("Webhook signature verification failed.", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      id: string;
      metadata: Record<string, string>;
      payment_intent: string | null;
    };

    const playerId = session.metadata?.player_id;
    const itemType = session.metadata?.item_type as PremiumItemType | undefined;

    if (!playerId || !itemType) {
      return new Response("Missing metadata.", { status: 400 });
    }

    const item = SHOP_CATALOG.find((i) => i.type === itemType);
    if (!item) {
      return new Response("Unknown item type.", { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    await admin.from("premium_entitlements").insert({
      player_id:    playerId,
      item_type:    itemType,
      item_config:  {},
      consumed:     false,
      purchase_ref: session.payment_intent ?? session.id,
    });
  }

  return new Response("ok", { status: 200 });
}
