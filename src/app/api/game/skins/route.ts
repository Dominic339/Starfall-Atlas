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

  // Available shop skins — fetch all is_available rows and filter date window in JS
  // (PostgREST .or() with ISO timestamps is unreliable due to '.' in the value)
  const rawShopResult = await admin
    .from("skins")
    .select("id, name, description, type, price_credits, price_premium_cents, discount_pct, available_from, available_until, rarity, visual, model_path")
    .eq("is_available", true);

  // If the visual or model_path column doesn't exist yet (migration pending), fall back without them
  const shopQueryResult = rawShopResult.error
    ? await admin
        .from("skins")
        .select("id, name, description, type, price_credits, price_premium_cents, discount_pct, available_from, available_until, rarity")
        .eq("is_available", true)
    : rawShopResult;

  if (shopQueryResult.error) {
    console.error("[skins GET] shop query error:", shopQueryResult.error);
  }

  const { data: shopRows } = listResult<{
    id: string; name: string; description: string; type: string;
    price_credits: number; price_premium_cents: number | null;
    discount_pct: number | null; available_from: string | null; available_until: string | null;
    rarity: string; visual?: Record<string, string> | null;
    model_path?: string | null;
  }>(shopQueryResult);

  const filteredShopRows = (shopRows ?? []).filter(
    (r) => (!r.available_from || r.available_from <= now) &&
           (!r.available_until || r.available_until >= now),
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

  // Fetch full DB rows for all owned skins (handles DB-only skins without code definitions)
  const { data: ownedDbRows } = ownedIds.size > 0
    ? listResult<{ id: string; name: string; description: string; type: string; rarity: string; visual?: Record<string,string> | null; model_path?: string | null; }>(
        await (async () => {
          const r = await admin.from("skins").select("id, name, description, type, rarity, visual, model_path").in("id", [...ownedIds]);
          return r.error
            ? admin.from("skins").select("id, name, description, type, rarity").in("id", [...ownedIds])
            : r;
        })()
      )
    : { data: [] };

  // Available shop packages — same pattern: fetch all, filter date window in JS
  const { data: pkgRows } = listResult<{
    id: string;
    name: string;
    description: string;
    price_credits: number | null;
    price_premium_cents: number | null;
    discount_pct: number | null;
    available_from: string | null;
    available_until: string | null;
  }>(
    await admin
      .from("skin_packages")
      .select("id, name, description, price_credits, price_premium_cents, discount_pct, available_from, available_until")
      .eq("is_available", true),
  );

  const filteredPkgRows = (pkgRows ?? []).filter(
    (p) => (!p.available_from || p.available_from <= now) &&
           (!p.available_until || p.available_until >= now),
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

  const shopSkins = filteredShopRows.map((row) => {
    const def = getSkinById(row.id);
    const dbVisual = (row.visual && Object.keys(row.visual).length > 0) ? row.visual : null;
    const effectivePrice =
      row.discount_pct != null
        ? Math.round(row.price_credits * (1 - row.discount_pct / 100))
        : row.price_credits;
    return {
      id: row.id,
      name: def?.name ?? row.name,
      description: def?.description ?? row.description,
      type: def?.type ?? row.type,
      rarity: def?.rarity ?? row.rarity,
      visual: def?.visual ?? dbVisual ?? {},
      modelPath: def?.modelPath ?? row.model_path ?? undefined,
      priceCredits: row.price_credits,
      effectivePrice,
      premiumCents: row.price_premium_cents,
      discountPct: row.discount_pct,
      availableUntil: row.available_until,
      owned: ownedIds.has(row.id),
    };
  });

  const shopPackages = filteredPkgRows.map((pkg) => {
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

  // Build owned skins list: merge DB rows with code definitions (handles DB-only skins too)
  const ownedDbMap = new Map((ownedDbRows ?? []).map((r) => [r.id, r]));
  const ownedSkins = [...ownedIds].map((sid) => {
    const codeDef = getSkinById(sid);
    const dbRow = ownedDbMap.get(sid);
    if (!dbRow && !codeDef) return null;
    const dbVisual = dbRow?.visual && Object.keys(dbRow.visual).length > 0 ? dbRow.visual : null;
    return {
      id: sid,
      name: codeDef?.name ?? dbRow?.name ?? sid,
      description: codeDef?.description ?? dbRow?.description ?? "",
      type: (codeDef?.type ?? dbRow?.type ?? "ship") as import("@/skins").SkinType,
      rarity: (codeDef?.rarity ?? dbRow?.rarity ?? "common") as import("@/skins").SkinRarity,
      visual: codeDef?.visual ?? dbVisual ?? {},
      modelPath: codeDef?.modelPath ?? dbRow?.model_path ?? undefined,
    };
  }).filter(Boolean) as import("@/skins").SkinDefinition[];

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
