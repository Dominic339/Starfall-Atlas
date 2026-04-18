/**
 * /game/market — Global Resource Market
 *
 * Players list resources from their station inventory for sale.
 * Other players can browse and buy. Resources are delivered instantly to
 * the buyer's station. A 2% listing fee is charged at listing time.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";
import type { Player } from "@/lib/types/game";
import { MarketClient } from "./_components/MarketClient";
import type { MarketListing, StationInventoryEntry } from "./_components/MarketClient";
import { runEngineTick } from "@/lib/game/engineTick";
import { runTravelResolution } from "@/lib/game/travelResolution";

export const dynamic = "force-dynamic";
export const metadata = { title: "Market — Starfall Atlas" };

export default async function MarketPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  const requestTime = new Date();
  await runEngineTick(admin, player.id, requestTime);
  await runTravelResolution(admin, player.id, requestTime);

  // ── Fetch player station ──────────────────────────────────────────────────
  const { data: station } = maybeSingleResult<{ id: string; current_system_id: string }>(
    await admin
      .from("player_stations")
      .select("id, current_system_id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );

  // ── Parallel fetches ──────────────────────────────────────────────────────
  const [listingsRes, inventoryRes] = await Promise.all([
    // All open sell listings (global market)
    admin
      .from("market_listings")
      .select("id, seller_id, resource_type, quantity, quantity_filled, price_per_unit, system_id, expires_at, status")
      .eq("side", "sell")
      .in("status", ["open", "partially_filled"])
      .order("price_per_unit", { ascending: true }),

    // Player's station inventory (to populate Create Listing form)
    station
      ? admin
          .from("resource_inventory")
          .select("resource_type, quantity")
          .eq("location_type", "station")
          .eq("location_id", station.id)
          .gt("quantity", 0)
          .order("resource_type", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  type ListingRow = {
    id: string;
    seller_id: string;
    resource_type: string;
    quantity: number;
    quantity_filled: number;
    price_per_unit: number;
    system_id: string;
    expires_at: string;
    status: string;
  };
  type InventoryRow = { resource_type: string; quantity: number };

  const rawListings = listResult<ListingRow>(listingsRes).data ?? [];
  const inventoryRows = listResult<InventoryRow>(inventoryRes).data ?? [];

  // ── Resolve seller handles ────────────────────────────────────────────────
  const sellerIds = [...new Set(rawListings.map((l) => l.seller_id))];
  const sellerHandles = new Map<string, string>();
  if (sellerIds.length > 0) {
    type HandleRow = { id: string; handle: string };
    const { data: handleRows } = listResult<HandleRow>(
      await admin.from("players").select("id, handle").in("id", sellerIds),
    );
    for (const h of handleRows ?? []) sellerHandles.set(h.id, h.handle);
  }

  // ── Build typed listing objects ───────────────────────────────────────────
  const listings: MarketListing[] = rawListings.map((l) => ({
    id:             l.id,
    resourceType:   l.resource_type,
    quantity:       l.quantity,
    quantityFilled: l.quantity_filled,
    pricePerUnit:   l.price_per_unit,
    sellerHandle:   sellerHandles.get(l.seller_id) ?? "Unknown",
    sellerId:       l.seller_id,
    systemId:       l.system_id,
    expiresAt:      l.expires_at,
    status:         l.status as "open" | "partially_filled",
  }));

  const myInventory: StationInventoryEntry[] = inventoryRows.map((r) => ({
    resourceType: r.resource_type,
    quantity:     r.quantity,
  }));

  const totalListings = listings.length;
  const myListingCount = listings.filter((l) => l.sellerId === player.id).length;

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Page header */}
      <div className="border-b border-zinc-800/60 bg-zinc-950 px-6 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-semibold text-zinc-200">Resource Market</h1>
              <p className="mt-0.5 text-xs text-zinc-600">
                {totalListings === 0
                  ? "No active listings"
                  : `${totalListings} listing${totalListings !== 1 ? "s" : ""}`}
                {myListingCount > 0 && (
                  <span className="ml-2 text-zinc-700">· {myListingCount} yours</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-zinc-600">
                Balance:{" "}
                <span className="font-mono text-amber-400">{player.credits.toLocaleString()} ¢</span>
              </span>
              <Link href="/game/station" className="text-zinc-600 hover:text-zinc-400 transition-colors">
                ← Station
              </Link>
            </div>
          </div>
          {/* Info strip */}
          <p className="mt-2 text-xs text-zinc-700">
            {BALANCE.market.listingFeePercent}% listing fee · {BALANCE.market.defaultExpiryDays}-day expiry · Instant global delivery
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-6 py-6">
        {!station ? (
          <p className="text-xs text-zinc-600">Station not found. Please try reloading.</p>
        ) : (
          <MarketClient
            listings={listings}
            myInventory={myInventory}
            playerCredits={player.credits}
            playerId={player.id}
            listingFeePercent={BALANCE.market.listingFeePercent}
          />
        )}
      </div>
    </div>
  );
}
