/**
 * GET /api/game/skins
 *
 * Returns the player's owned skins and currently equipped skins.
 * Also returns all available skins in the shop (is_available = true and within window).
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import { ALL_SKINS, getSkinById } from "@/skins";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const now = new Date().toISOString();

  // Available shop skins (time-window checked server-side)
  const { data: shopRows } = listResult<{
    id: string;
    price_credits: number;
    price_premium_cents: number | null;
    discount_pct: number | null;
    available_until: string | null;
    rarity: string;
  }>(
    await admin
      .from("skins")
      .select("id, price_credits, price_premium_cents, discount_pct, available_until, rarity")
      .eq("is_available", true)
      .or(`available_from.is.null,available_from.lte.${now}`)
      .or(`available_until.is.null,available_until.gte.${now}`),
  );

  // Player-owned skins
  const { data: ownedRows } = listResult<{ skin_id: string; acquired_at: string }>(
    await admin
      .from("player_skins")
      .select("skin_id, acquired_at")
      .eq("player_id", player.id),
  );

  // Equipped skins
  const { data: equippedRows } = listResult<{
    ship_skin_id: string | null;
    station_skin_id: string | null;
    fleet_skin_id: string | null;
  }>(
    await admin
      .from("player_equipped_skins")
      .select("ship_skin_id, station_skin_id, fleet_skin_id")
      .eq("player_id", player.id),
  );

  const equipped = equippedRows?.[0] ?? {
    ship_skin_id: null,
    station_skin_id: null,
    fleet_skin_id: null,
  };

  const ownedIds = new Set((ownedRows ?? []).map((r) => r.skin_id));

  // Available shop packages
  const { data: pkgRows } = listResult<{
    id: string;
    name: string;
    description: string;
    price_credits: number | null;
    price_premium_cents: number | null;
    discount_pct: number | null;
    available_until: string | null;
  }>(
    await admin
      .from("skin_packages")
      .select("id, name, description, price_credits, price_premium_cents, discount_pct, available_until")
      .eq("is_available", true)
      .or(`available_from.is.null,available_from.lte.${now}`)
      .or(`available_until.is.null,available_until.gte.${now}`),
  );

  const { data: pkgItemRows } = listResult<{ package_id: string; skin_id: string }>(
    await admin
      .from("skin_package_items")
      .select("package_id, skin_id"),
  );

  const pkgSkinIds = new Map<string, string[]>();
  for (const row of pkgItemRows ?? []) {
    const list = pkgSkinIds.get(row.package_id) ?? [];
    list.push(row.skin_id);
    pkgSkinIds.set(row.package_id, list);
  }

  const shopSkins = (shopRows ?? []).map((row) => {
    const def = getSkinById(row.id);
    const effectivePrice =
      row.discount_pct != null
        ? Math.round(row.price_credits * (1 - row.discount_pct / 100))
        : row.price_credits;
    return {
      id: row.id,
      name: def?.name ?? row.id,
      description: def?.description ?? "",
      type: def?.type ?? "ship",
      rarity: def?.rarity ?? row.rarity,
      visual: def?.visual ?? {},
      priceCredits: row.price_credits,
      effectivePrice,
      premiumCents: row.price_premium_cents,
      discountPct: row.discount_pct,
      availableUntil: row.available_until,
      owned: ownedIds.has(row.id),
    };
  });

  const shopPackages = (pkgRows ?? []).map((pkg) => {
    const skinIds = pkgSkinIds.get(pkg.id) ?? [];
    const skins = skinIds.map((sid) => {
      const def = getSkinById(sid);
      return { id: sid, name: def?.name ?? sid, type: def?.type ?? "ship", visual: def?.visual ?? {} };
    });
    const allOwned = skinIds.every((sid) => ownedIds.has(sid));
    const effectivePrice =
      pkg.price_credits != null && pkg.discount_pct != null
        ? Math.round(pkg.price_credits * (1 - pkg.discount_pct / 100))
        : pkg.price_credits;
    return {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      priceCredits: pkg.price_credits,
      effectivePrice,
      premiumCents: pkg.price_premium_cents,
      discountPct: pkg.discount_pct,
      availableUntil: pkg.available_until,
      skins,
      allOwned,
    };
  });

  const ownedSkins = ALL_SKINS.filter((s) => ownedIds.has(s.id));

  return Response.json({
    ok: true,
    data: {
      ownedSkins,
      equipped: {
        shipSkinId: equipped.ship_skin_id,
        stationSkinId: equipped.station_skin_id,
        fleetSkinId: equipped.fleet_skin_id,
      },
      shopSkins,
      shopPackages,
      playerCredits: player.credits,
    },
  });
}
