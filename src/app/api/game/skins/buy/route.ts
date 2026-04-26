/**
 * POST /api/game/skins/buy
 *
 * Purchase a single skin or a package with in-game credits.
 * Body: { skinId?: string; packageId?: string }
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult, listResult } from "@/lib/supabase/utils";
import { getSkinById } from "@/skins";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await req.json().catch(() => ({}));
  const { skinId, packageId } = body as { skinId?: string; packageId?: string };

  if (!skinId && !packageId) {
    return Response.json({ ok: false, error: "skinId or packageId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date().toISOString();

  if (skinId) {
    // ── Single skin purchase ──────────────────────────────────────────────
    const { data: skin } = singleResult<{
      id: string;
      price_credits: number;
      discount_pct: number | null;
      is_available: boolean;
      available_from: string | null;
      available_until: string | null;
    }>(await admin.from("skins").select("*").eq("id", skinId).single());

    if (!skin) return Response.json({ ok: false, error: "Skin not found" }, { status: 404 });
    if (!skin.is_available) return Response.json({ ok: false, error: "Skin not available" }, { status: 400 });
    if (skin.available_from && skin.available_from > now) {
      return Response.json({ ok: false, error: "Skin not yet available" }, { status: 400 });
    }
    if (skin.available_until && skin.available_until < now) {
      return Response.json({ ok: false, error: "Skin offer has expired" }, { status: 400 });
    }

    // Check ownership
    const { data: existing } = await admin
      .from("player_skins")
      .select("id")
      .eq("player_id", player.id)
      .eq("skin_id", skinId)
      .maybeSingle();
    if (existing) return Response.json({ ok: false, error: "You already own this skin" }, { status: 400 });

    const effectivePrice =
      skin.discount_pct != null
        ? Math.round(skin.price_credits * (1 - skin.discount_pct / 100))
        : skin.price_credits;

    if (player.credits < effectivePrice) {
      return Response.json({ ok: false, error: "Insufficient credits" }, { status: 400 });
    }

    // Deduct credits + grant skin in a pseudo-transaction
    const { error: deductErr } = await admin
      .from("players")
      .update({ credits: player.credits - effectivePrice })
      .eq("id", player.id)
      .gte("credits", effectivePrice); // optimistic check

    if (deductErr) return Response.json({ ok: false, error: "Failed to deduct credits" }, { status: 500 });

    await admin.from("player_skins").insert({
      player_id: player.id,
      skin_id: skinId,
      source: "purchase",
    });

    await admin.from("skin_purchases").insert({
      player_id: player.id,
      skin_id: skinId,
      credits_paid: effectivePrice,
    });

    const def = getSkinById(skinId);
    return Response.json({ ok: true, data: { skinId, name: def?.name ?? skinId, creditsSpent: effectivePrice } });
  }

  // ── Package purchase ──────────────────────────────────────────────────────
  const { data: pkg } = singleResult<{
    id: string;
    name: string;
    price_credits: number | null;
    discount_pct: number | null;
    is_available: boolean;
    available_from: string | null;
    available_until: string | null;
  }>(await admin.from("skin_packages").select("*").eq("id", packageId).single());

  if (!pkg) return Response.json({ ok: false, error: "Package not found" }, { status: 404 });
  if (!pkg.is_available) return Response.json({ ok: false, error: "Package not available" }, { status: 400 });
  if (pkg.available_from && pkg.available_from > now) {
    return Response.json({ ok: false, error: "Package not yet available" }, { status: 400 });
  }
  if (pkg.available_until && pkg.available_until < now) {
    return Response.json({ ok: false, error: "Package offer has expired" }, { status: 400 });
  }
  if (!pkg.price_credits) return Response.json({ ok: false, error: "Package has no credit price" }, { status: 400 });

  const effectivePrice =
    pkg.discount_pct != null
      ? Math.round(pkg.price_credits * (1 - pkg.discount_pct / 100))
      : pkg.price_credits;

  if (player.credits < effectivePrice) {
    return Response.json({ ok: false, error: "Insufficient credits" }, { status: 400 });
  }

  // Get skins in this package
  const { data: pkgItems } = listResult<{ skin_id: string }>(
    await admin.from("skin_package_items").select("skin_id").eq("package_id", packageId),
  );

  const skinIds = (pkgItems ?? []).map((r) => r.skin_id);
  if (skinIds.length === 0) return Response.json({ ok: false, error: "Package is empty" }, { status: 400 });

  // Check which skins are already owned
  const { data: ownedRows } = listResult<{ skin_id: string }>(
    await admin
      .from("player_skins")
      .select("skin_id")
      .eq("player_id", player.id)
      .in("skin_id", skinIds),
  );
  const alreadyOwned = new Set((ownedRows ?? []).map((r) => r.skin_id));
  const newSkins = skinIds.filter((id) => !alreadyOwned.has(id));

  // Deduct credits
  const { error: deductErr } = await admin
    .from("players")
    .update({ credits: player.credits - effectivePrice })
    .eq("id", player.id)
    .gte("credits", effectivePrice);

  if (deductErr) return Response.json({ ok: false, error: "Failed to deduct credits" }, { status: 500 });

  // Grant new skins
  if (newSkins.length > 0) {
    await admin.from("player_skins").insert(
      newSkins.map((sid) => ({ player_id: player.id, skin_id: sid, source: "package" })),
    );
  }

  await admin.from("skin_purchases").insert({
    player_id: player.id,
    package_id: packageId,
    credits_paid: effectivePrice,
  });

  return Response.json({
    ok: true,
    data: { packageId, name: pkg.name, creditsSpent: effectivePrice, newSkinsGranted: newSkins.length },
  });
}
