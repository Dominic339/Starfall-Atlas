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
    // Transfer item to winner
    if (auction.item_type === "colony") {
      await admin
        .from("colonies")
        .update({ owner_id: auction.high_bidder_id })
        .eq("id", auction.item_id)
        .eq("owner_id", auction.seller_id);
    } else if (auction.item_type === "stewardship") {
      await admin
        .from("system_stewardship")
        .update({ steward_id: auction.high_bidder_id })
        .eq("system_id", auction.item_id)
        .eq("steward_id", auction.seller_id);
    }

    // Transfer escrowed credits to seller (bidder already paid)
    const { data: sellerRow } = await admin
      .from("players")
      .select("credits")
      .eq("id", auction.seller_id)
      .maybeSingle();

    if (sellerRow) {
      await admin
        .from("players")
        .update({ credits: (sellerRow as { credits: number }).credits + auction.current_high_bid })
        .eq("id", auction.seller_id);
    }

    // Determine system_id for world event + influence refresh
    let systemId: string | null = null;
    if (auction.item_type === "stewardship") {
      systemId = auction.item_id;
    } else if (auction.item_type === "colony") {
      const { data: colonyRow } = await admin
        .from("colonies")
        .select("system_id")
        .eq("id", auction.item_id)
        .maybeSingle();
      systemId = (colonyRow as { system_id: string } | null)?.system_id ?? null;
    }

    await admin.from("world_events").insert({
      event_type: "auction_resolved",
      player_id: auction.high_bidder_id,
      system_id: systemId,
      body_id: null,
      metadata: {
        auction_id: auctionId,
        item_type: auction.item_type,
        item_id: auction.item_id,
        price: auction.current_high_bid,
        seller_id: auction.seller_id,
      },
    });

    await admin
      .from("auctions")
      .update({ status: "resolved", resolved_at: resolvedAt })
      .eq("id", auctionId);

    if (systemId) {
      void refreshInfluenceCache(admin, systemId).catch(() => undefined);
    }
  } else {
    // No bids — cancel
    await admin
      .from("auctions")
      .update({ status: "cancelled", resolved_at: resolvedAt })
      .eq("id", auctionId);
  }

  // Release all bid escrows for this auction
  await admin
    .from("auction_bids")
    .update({ escrow_held: false })
    .eq("auction_id", auctionId);
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
