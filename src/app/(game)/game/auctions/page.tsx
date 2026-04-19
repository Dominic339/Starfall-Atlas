/**
 * /game/auctions — Auction board
 *
 * Lists all active auctions. Lazily resolves any expired auctions on load.
 * Players can bid on others' auctions and create new auctions from their
 * eligible colonies and stewardships.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { systemDisplayName } from "@/lib/catalog";
import { BALANCE } from "@/lib/config/balance";
import { resolveExpiredAuctions } from "@/lib/game/auction";
import type { Player } from "@/lib/types/game";
import AuctionClient, {
  type AuctionDisplay,
  type EligibleItem,
} from "./_components/AuctionClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Auctions — Starfall Atlas",
};

export default async function AuctionsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  const now = new Date();

  // ── Lazy resolution of expired auctions ──────────────────────────────────
  await resolveExpiredAuctions(admin, now).catch(() => undefined);

  // ── Fetch active auctions and player's auction-eligible items ─────────────
  const [auctionsRes, coloniesRes, stewardshipsRes] = await Promise.all([
    admin.from("auctions").select("*").eq("status", "active").order("ends_at", { ascending: true }),
    admin
      .from("colonies")
      .select("id, system_id, body_id, population_tier, status")
      .eq("owner_id", player.id)
      .eq("status", "active"),
    admin
      .from("system_stewardship")
      .select("system_id")
      .eq("steward_id", player.id),
  ]);

  type RawAuction = {
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

  type RawColony = {
    id: string;
    system_id: string;
    body_id: string;
    population_tier: number;
    status: string;
  };

  const rawAuctions = (listResult<RawAuction>(auctionsRes).data ?? []) as RawAuction[];
  const playerColonies = (listResult<RawColony>(coloniesRes).data ?? []) as RawColony[];
  const playerStewardships = (
    listResult<{ system_id: string }>(stewardshipsRes).data ?? []
  ) as { system_id: string }[];

  // ── Resolve seller handles ────────────────────────────────────────────────
  const sellerIds = [...new Set(rawAuctions.map((a) => a.seller_id))];
  const handleMap = new Map<string, string>();

  if (sellerIds.length > 0) {
    const { data: sellerRows } = await admin
      .from("players")
      .select("id, handle")
      .in("id", sellerIds);

    for (const row of (sellerRows ?? []) as { id: string; handle: string }[]) {
      handleMap.set(row.id, row.handle);
    }
  }

  // ── Resolve colony data for colony-type auctions ──────────────────────────
  const colonyAuctionIds = rawAuctions
    .filter((a) => a.item_type === "colony")
    .map((a) => a.item_id);

  const colonyDataMap = new Map<string, RawColony>();
  if (colonyAuctionIds.length > 0) {
    const { data: colonyRows } = await admin
      .from("colonies")
      .select("id, system_id, body_id, population_tier, status")
      .in("id", colonyAuctionIds);

    for (const c of (colonyRows ?? []) as RawColony[]) {
      colonyDataMap.set(c.id, c);
    }
  }

  // ── Build AuctionDisplay[] ────────────────────────────────────────────────
  const auctions: AuctionDisplay[] = rawAuctions.map((a) => {
    let itemLabel = a.item_id;

    if (a.item_type === "colony") {
      const c = colonyDataMap.get(a.item_id);
      if (c) {
        const bodyIdx = c.body_id.slice(c.body_id.lastIndexOf(":") + 1);
        itemLabel = `${systemDisplayName(c.system_id)} · Body ${bodyIdx} · T${c.population_tier}`;
      }
    } else if (a.item_type === "stewardship") {
      itemLabel = `${systemDisplayName(a.item_id)} system`;
    }

    return {
      id: a.id,
      itemType: a.item_type as "colony" | "stewardship",
      itemId: a.item_id,
      itemLabel,
      minBid: a.min_bid,
      currentHighBid: a.current_high_bid,
      highBidderId: a.high_bidder_id,
      sellerId: a.seller_id,
      sellerHandle: handleMap.get(a.seller_id) ?? "unknown",
      endsAt: a.ends_at,
    };
  });

  // ── Build eligible items for create form ──────────────────────────────────
  // Exclude any item that already has an active auction
  const activeAuctionItemIds = new Set(rawAuctions.map((a) => a.item_id));

  const eligibleItems: EligibleItem[] = [
    ...playerColonies
      .filter((c) => !activeAuctionItemIds.has(c.id))
      .map((c): EligibleItem => {
        const bodyIdx = c.body_id.slice(c.body_id.lastIndexOf(":") + 1);
        return {
          id: c.id,
          type: "colony",
          label: `${systemDisplayName(c.system_id)} · Body ${bodyIdx} · T${c.population_tier}`,
        };
      }),
    ...playerStewardships
      .filter((s) => !activeAuctionItemIds.has(s.system_id))
      .map((s): EligibleItem => ({
        id: s.system_id,
        type: "stewardship",
        label: `${systemDisplayName(s.system_id)} system`,
      })),
  ];

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Auction Board</h1>
        <p className="mt-0.5 text-sm text-zinc-600">
          Buy and sell colonies and stewardship rights via blind ascending auctions. Anti-snipe:{" "}
          bids placed within {BALANCE.auctions.antiSnipeWindowMinutes} min of the deadline extend
          the timer by {BALANCE.auctions.antiSnipeExtensionMinutes} min.
        </p>
      </div>

      <AuctionClient
        auctions={auctions}
        eligibleItems={eligibleItems}
        playerCredits={player.credits}
        playerId={player.id}
        minDurationHours={BALANCE.auctions.minDurationHours}
        maxDurationDays={BALANCE.auctions.maxDurationDays}
        defaultDurationHours={BALANCE.auctions.defaultDurationHours}
      />
    </div>
  );
}
