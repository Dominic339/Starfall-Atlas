/**
 * GET /api/game/market/panel
 *
 * Returns everything the market map-overlay needs:
 *   - All open/partially-filled sell listings (with seller handles)
 *   - The current player's station inventory (to populate Create Listing)
 *   - Player credits
 *   - Listing fee % from balance config
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";
import type { PlayerStation } from "@/lib/types/game";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: station } = maybeSingleResult<PlayerStation>(
    await admin
      .from("player_stations")
      .select("id, current_system_id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );

  const [listingsRes, inventoryRes] = await Promise.all([
    admin
      .from("market_listings")
      .select("id, seller_id, resource_type, quantity, quantity_filled, price_per_unit, system_id, expires_at, status")
      .eq("side", "sell")
      .in("status", ["open", "partially_filled"])
      .order("price_per_unit", { ascending: true }),

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
    id: string; seller_id: string; resource_type: string;
    quantity: number; quantity_filled: number; price_per_unit: number;
    system_id: string; expires_at: string; status: string;
  };
  type InventoryRow = { resource_type: string; quantity: number };

  const rawListings = listResult<ListingRow>(listingsRes).data ?? [];
  const inventoryRows = listResult<InventoryRow>(inventoryRes).data ?? [];

  // Resolve seller handles
  const sellerIds = [...new Set(rawListings.map((l) => l.seller_id))];
  const sellerHandles = new Map<string, string>();
  if (sellerIds.length > 0) {
    type HandleRow = { id: string; handle: string };
    const { data: hRows } = listResult<HandleRow>(
      await admin.from("players").select("id, handle").in("id", sellerIds),
    );
    for (const h of hRows ?? []) sellerHandles.set(h.id, h.handle);
  }

  const listings = rawListings.map((l) => ({
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

  const inventory = inventoryRows.map((r) => ({
    resourceType: r.resource_type,
    quantity:     r.quantity,
  }));

  // Per-resource market stats derived from active listings.
  const statsByResource = new Map<string, { prices: number[]; supply: number }>();
  for (const l of rawListings) {
    const remaining = l.quantity - l.quantity_filled;
    if (remaining <= 0) continue;
    const entry = statsByResource.get(l.resource_type) ?? { prices: [], supply: 0 };
    entry.prices.push(l.price_per_unit);
    entry.supply += remaining;
    statsByResource.set(l.resource_type, entry);
  }
  const marketStats = Array.from(statsByResource.entries()).map(([resourceType, { prices, supply }]) => {
    const sorted = [...prices].sort((a, b) => a - b);
    const avg = Math.round(sorted.reduce((s, p) => s + p, 0) / sorted.length);
    return {
      resourceType,
      minPrice:      sorted[0],
      maxPrice:      sorted[sorted.length - 1],
      avgPrice:      avg,
      totalSupply:   supply,
      listingCount:  prices.length,
    };
  });

  return Response.json({
    ok: true,
    data: {
      listings,
      inventory,
      marketStats,
      playerCredits:    player.credits,
      playerId:         player.id,
      listingFeePercent: BALANCE.market.listingFeePercent,
    },
  });
}
