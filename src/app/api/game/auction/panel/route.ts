/**
 * GET /api/game/auction/panel
 *
 * Returns active auctions plus the player's eligible items for creating auctions.
 * Also resolves expired auctions lazily on load.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import { systemDisplayName } from "@/lib/catalog";
import { resolveExpiredAuctions } from "@/lib/game/auction";
import type { Player } from "@/lib/types/game";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data as { player: Player };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  await resolveExpiredAuctions(admin, new Date()).catch(() => undefined);

  type RawAuction = {
    id: string; seller_id: string; item_type: string; item_id: string;
    min_bid: number; current_high_bid: number; high_bidder_id: string | null;
    ends_at: string; status: string;
  };
  type RawColony = { id: string; system_id: string; body_id: string; population_tier: number };

  const [auctionsRes, coloniesRes, stewardRes] = await Promise.all([
    admin.from("auctions").select("*").eq("status", "active").order("ends_at", { ascending: true }),
    admin.from("colonies").select("id, system_id, body_id, population_tier").eq("owner_id", player.id).eq("status", "active"),
    admin.from("system_stewardship").select("system_id").eq("steward_id", player.id),
  ]);

  const rawAuctions = (listResult<RawAuction>(auctionsRes).data ?? []);
  const playerColonies = (listResult<RawColony>(coloniesRes).data ?? []);
  const playerStewardships = (listResult<{ system_id: string }>(stewardRes).data ?? []);

  // Resolve seller handles
  const sellerIds = [...new Set(rawAuctions.map((a) => a.seller_id))];
  const handleMap = new Map<string, string>();
  if (sellerIds.length > 0) {
    const { data: sellers } = await admin.from("players").select("id, handle").in("id", sellerIds);
    for (const s of (sellers ?? []) as { id: string; handle: string }[]) handleMap.set(s.id, s.handle);
  }

  // Resolve colony data for colony-type auctions
  const colonyIds = rawAuctions.filter((a) => a.item_type === "colony").map((a) => a.item_id);
  const colonyDataMap = new Map<string, RawColony>();
  if (colonyIds.length > 0) {
    const { data: cols } = await admin.from("colonies").select("id, system_id, body_id, population_tier").in("id", colonyIds);
    for (const c of (cols ?? []) as RawColony[]) colonyDataMap.set(c.id, c);
  }

  const auctions = rawAuctions.map((a) => {
    let itemLabel = a.item_id;
    if (a.item_type === "colony") {
      const c = colonyDataMap.get(a.item_id);
      if (c) {
        const bodyIdx = c.body_id.slice(c.body_id.lastIndexOf(":") + 1);
        itemLabel = `${systemDisplayName(c.system_id)} · Body ${bodyIdx} (T${c.population_tier})`;
      }
    } else if (a.item_type === "stewardship") {
      itemLabel = `${systemDisplayName(a.item_id)} stewardship`;
    }

    const msLeft = new Date(a.ends_at).getTime() - Date.now();
    const hLeft  = Math.max(0, Math.floor(msLeft / 3_600_000));
    const mLeft  = Math.max(0, Math.ceil((msLeft % 3_600_000) / 60_000));
    const timeLeft = msLeft <= 0 ? "Ending…" : hLeft > 0 ? `${hLeft}h ${mLeft}m` : `${mLeft}m`;

    return {
      id: a.id,
      itemType: a.item_type,
      itemLabel,
      minBid: a.min_bid,
      currentHighBid: a.current_high_bid,
      highBidderId: a.high_bidder_id,
      isOwnAuction: a.seller_id === player.id,
      isHighBidder: a.high_bidder_id === player.id,
      sellerHandle: handleMap.get(a.seller_id) ?? "Unknown",
      endsAt: a.ends_at,
      timeLeft,
    };
  });

  // Eligible items for creating auctions
  const auctionedColonyIds = new Set(rawAuctions.filter((a) => a.item_type === "colony").map((a) => a.item_id));
  const auctionedStewardIds = new Set(rawAuctions.filter((a) => a.item_type === "stewardship").map((a) => a.item_id));

  const eligibleColonies = playerColonies
    .filter((c) => !auctionedColonyIds.has(c.id))
    .map((c) => {
      const bodyIdx = c.body_id.slice(c.body_id.lastIndexOf(":") + 1);
      return { id: c.id, type: "colony" as const, label: `${systemDisplayName(c.system_id)} · Body ${bodyIdx} (T${c.population_tier})` };
    });

  const eligibleStewardships = playerStewardships
    .filter((s) => !auctionedStewardIds.has(s.system_id))
    .map((s) => ({ id: s.system_id, type: "stewardship" as const, label: `${systemDisplayName(s.system_id)} stewardship` }));

  return Response.json({
    ok: true,
    data: {
      auctions,
      eligibleItems: [...eligibleColonies, ...eligibleStewardships],
      playerCredits: player.credits,
    },
  });
}
