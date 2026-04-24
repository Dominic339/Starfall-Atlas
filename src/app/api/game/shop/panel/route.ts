/**
 * GET /api/game/shop/panel
 *
 * Returns the static shop catalog plus the player's current entitlements.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import { SHOP_CATALOG, findShopItem } from "@/lib/config/shop";
import type { PremiumItemType } from "@/lib/types/enums";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  type RawEntitlement = {
    id: string;
    item_type: PremiumItemType;
    item_config: Record<string, unknown>;
    consumed: boolean;
    created_at: string;
  };

  const { data: raw } = listResult<RawEntitlement>(
    await admin
      .from("premium_entitlements")
      .select("id, item_type, item_config, consumed, created_at")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false }),
  );

  const entitlements = (raw ?? []).map((e) => ({
    id: e.id,
    itemType: e.item_type,
    itemName: findShopItem(e.item_type)?.name ?? e.item_type,
    consumed: e.consumed,
    purchasedAt: e.created_at,
  }));

  return Response.json({ ok: true, data: { catalog: SHOP_CATALOG, entitlements } });
}
