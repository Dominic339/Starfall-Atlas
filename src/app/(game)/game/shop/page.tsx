/**
 * /game/shop — Premium Shop (Phase 13)
 *
 * Server component. Fetches the player's current entitlements so the page
 * shows what has already been purchased. The catalog itself is static config.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { SHOP_CATALOG, findShopItem } from "@/lib/config/shop";
import type { Player } from "@/lib/types/game";
import type { PremiumItemType } from "@/lib/types/enums";
import { ShopClient, type EntitlementEntry } from "./_components/ShopClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Premium Shop — Starfall Atlas" };

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("id, handle").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // ── Fetch entitlements ────────────────────────────────────────────────────
  type RawEntitlement = {
    id: string;
    item_type: PremiumItemType;
    item_config: Record<string, unknown>;
    consumed: boolean;
    created_at: string;
  };
  const { data: rawEntitlements } = listResult<RawEntitlement>(
    await admin
      .from("premium_entitlements")
      .select("id, item_type, item_config, consumed, created_at")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false }),
  );

  const entitlements: EntitlementEntry[] = (rawEntitlements ?? []).map((e) => ({
    id: e.id,
    itemType: e.item_type,
    itemName: findShopItem(e.item_type)?.name ?? e.item_type,
    itemConfig: e.item_config ?? {},
    consumed: e.consumed,
    purchasedAt: e.created_at,
  }));

  const sp = await searchParams;
  const successItem = sp.success === "1" ? (sp.item ?? null) : null;
  const cancelled   = sp.cancelled === "1";

  return (
    <div className="max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link
          href="/game/command"
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          ← Command
        </Link>
        <span className="text-zinc-800 text-xs">/</span>
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Premium Shop
        </span>
      </div>

      {/* Flash messages */}
      {successItem && (
        <div className="rounded border border-emerald-800/50 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
          Purchase successful — <strong>{successItem}</strong> added to your items.
        </div>
      )}
      {cancelled && (
        <div className="rounded border border-zinc-700/50 bg-zinc-800/20 px-4 py-3 text-sm text-zinc-400">
          Purchase cancelled.
        </div>
      )}

      <div>
        <h1 className="text-lg font-bold tracking-tight text-zinc-100">Premium Shop</h1>
        <p className="mt-1 text-xs text-zinc-500">
          All items are account-bound and cannot be traded. Cosmetics are permanent;
          utility items are single-use. No gameplay advantages are sold here — see the{" "}
          <Link href="/game/rules#anti-pay-to-win" className="underline hover:text-zinc-300">
            Anti-Pay-to-Win guardrails
          </Link>
          .
        </p>
      </div>

      <ShopClient catalog={SHOP_CATALOG} entitlements={entitlements} />
    </div>
  );
}
