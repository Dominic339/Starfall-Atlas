import { refreshInfluenceCache } from "@/lib/game/influence";

type AuctionRow = {
  id: string;
  seller_id: string;
  item_type: string;
  item_id: string;
  min_bid: number;
  current_high_bid: number;
  high_bidder_id: string | null;
  ends_at: string;
  status: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveAuction(admin: any, auctionId: string, now: Date): Promise<void> {
  const { data: raw } = await admin
    .from("auctions")
    .select("*")
    .eq("id", auctionId)
    .eq("status", "active")
    .maybeSingle();

  if (!raw) return;
  const auction = raw as AuctionRow;

  if (new Date(auction.ends_at) > now) return;

  const resolvedAt = now.toISOString();

  if (auction.high_bidder_id) {
    // Transfer item + fetch seller credits + (colony) fetch system_id in parallel
    const transferP = auction.item_type === "colony"
      ? admin.from("colonies").update({ owner_id: auction.high_bidder_id }).eq("id", auction.item_id).eq("owner_id", auction.seller_id)
      : auction.item_type === "stewardship"
        ? admin.from("system_stewardship").update({ steward_id: auction.high_bidder_id }).eq("system_id", auction.item_id).eq("steward_id", auction.seller_id)
        : Promise.resolve(null);

    const systemId: string | null = auction.item_type === "stewardship" ? auction.item_id : null;
    const colonySystemP = auction.item_type === "colony"
      ? admin.from("colonies").select("system_id").eq("id", auction.item_id).maybeSingle()
      : Promise.resolve(null);

    const [, sellerRes, colonySystemRes] = await Promise.all([
      transferP,
      admin.from("players").select("credits").eq("id", auction.seller_id).maybeSingle(),
      colonySystemP,
    ]);

    const sellerRow = sellerRes?.data as { credits: number } | null;
    const resolvedSystemId: string | null = systemId ?? (colonySystemRes?.data as { system_id: string } | null)?.system_id ?? null;

    // Write: update seller credits + insert world event + close auction + release escrows
    await Promise.all([
      sellerRow
        ? admin.from("players").update({ credits: sellerRow.credits + auction.current_high_bid }).eq("id", auction.seller_id)
        : Promise.resolve(null),
      admin.from("world_events").insert({
        event_type: "auction_resolved",
        player_id: auction.high_bidder_id,
        system_id: resolvedSystemId,
        body_id: null,
        metadata: {
          auction_id: auctionId,
          item_type: auction.item_type,
          item_id: auction.item_id,
          price: auction.current_high_bid,
          seller_id: auction.seller_id,
        },
      }),
      admin.from("auctions").update({ status: "resolved", resolved_at: resolvedAt }).eq("id", auctionId),
      admin.from("auction_bids").update({ escrow_held: false }).eq("auction_id", auctionId),
    ]);

    if (resolvedSystemId) {
      void refreshInfluenceCache(admin, resolvedSystemId).catch(() => undefined);
    }
  } else {
    // No bids — cancel auction + release escrows in parallel
    await Promise.all([
      admin.from("auctions").update({ status: "cancelled", resolved_at: resolvedAt }).eq("id", auctionId),
      admin.from("auction_bids").update({ escrow_held: false }).eq("auction_id", auctionId),
    ]);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveExpiredAuctions(admin: any, now: Date): Promise<void> {
  const { data: expired } = await admin
    .from("auctions")
    .select("id")
    .eq("status", "active")
    .lte("ends_at", now.toISOString());

  const ids = ((expired ?? []) as { id: string }[]).map((a) => a.id);
  await Promise.all(ids.map((id) => resolveAuction(admin, id, now).catch(() => undefined)));
}
