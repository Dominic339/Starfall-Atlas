/**
 * /game/admin — In-game admin dev tool (is_dev players only).
 *
 * Lets admins manage the skin catalog and shop packages/deals:
 * publish skins, set pricing, add time-limited discounts, build bundles.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import type { Player } from "@/lib/types/game";
import { ALL_SKINS } from "@/skins";
import { AdminDevClient } from "./_components/AdminDevClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin Dev Tool — Starfall Atlas" };

export default async function AdminDevPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("id, handle, is_dev").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");
  if (!player.is_dev) redirect("/game/command");

  // ── Fetch current skin catalog from DB ───────────────────────────────────
  type SkinRow = {
    id: string; name: string; description: string; type: string; rarity: string;
    price_credits: number; price_premium_cents: number | null;
    discount_pct: number | null; is_available: boolean;
    available_from: string | null; available_until: string | null;
    created_at: string; updated_at: string;
  };
  const { data: dbSkins } = listResult<SkinRow>(
    await admin.from("skins").select("*").order("type").order("rarity"),
  );

  // ── Fetch packages ────────────────────────────────────────────────────────
  type PackageRow = {
    id: string; name: string; description: string;
    price_credits: number | null; price_premium_cents: number | null;
    discount_pct: number | null; is_available: boolean;
    available_from: string | null; available_until: string | null;
    created_at: string; updated_at: string;
  };
  const { data: packages } = listResult<PackageRow>(
    await admin.from("skin_packages").select("*").order("created_at", { ascending: false }),
  );

  const { data: pkgItems } = listResult<{ package_id: string; skin_id: string }>(
    await admin.from("skin_package_items").select("package_id, skin_id"),
  );

  const pkgSkinMap = new Map<string, string[]>();
  for (const row of pkgItems ?? []) {
    const list = pkgSkinMap.get(row.package_id) ?? [];
    list.push(row.skin_id);
    pkgSkinMap.set(row.package_id, list);
  }

  const enrichedPackages = (packages ?? []).map((p) => ({
    ...p, skinIds: pkgSkinMap.get(p.id) ?? [],
  }));

  return (
    <div className="max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link href="/game/command" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
          ← Command
        </Link>
        <span className="text-zinc-800 text-xs">/</span>
        <span className="text-xs font-semibold uppercase tracking-widest text-red-500">Admin Dev Tool</span>
      </div>

      <div className="rounded-lg border border-red-900/40 bg-red-950/10 px-4 py-2.5 text-xs text-red-400">
        ⚠ This tool is only visible to <strong>is_dev</strong> accounts. Changes take effect immediately.
      </div>

      <AdminDevClient
        dbSkins={dbSkins ?? []}
        packages={enrichedPackages}
        allSkinDefs={ALL_SKINS}
      />
    </div>
  );
}
