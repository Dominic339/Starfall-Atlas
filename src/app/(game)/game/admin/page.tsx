/**
 * /game/admin — In-game admin dev tool (is_dev players only).
 *
 * Tabs: Ships · Balance · Events · Battle Pass · Skins · Bundles
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

  // ── Parallel fetches ──────────────────────────────────────────────────────
  const [
    skinsRes, pkgsRes, pkgItemsRes,
    shipClassesRes, balanceRes, eventsRes, nodesRes,
    passesRes, tiersRes,
  ] = await Promise.all([
    admin.from("skins").select("*").order("type").order("rarity"),
    admin.from("skin_packages").select("*").order("created_at", { ascending: false }),
    admin.from("skin_package_items").select("package_id, skin_id"),
    admin.from("ship_classes").select("*").order("sort_order").order("name"),
    admin.from("balance_overrides").select("key, value, description, updated_at").order("key"),
    admin.from("live_events").select("*").order("starts_at", { ascending: false }),
    admin.from("live_event_nodes").select("id, event_id, resource_type, remaining_amount, status"),
    admin.from("battle_passes").select("*").order("season_number", { ascending: false }),
    admin.from("battle_pass_tiers").select("*").order("tier"),
  ]);

  // ── Skins ─────────────────────────────────────────────────────────────────
  type SkinRow = { id: string; name: string; description: string; type: string; rarity: string; price_credits: number; price_premium_cents: number | null; discount_pct: number | null; is_available: boolean; available_from: string | null; available_until: string | null; model_path: string | null; visual: Record<string, string>; created_at: string; updated_at: string; };
  const { data: dbSkins } = listResult<SkinRow>(skinsRes);

  const { data: pkgItems } = listResult<{ package_id: string; skin_id: string }>(pkgItemsRes);
  type PackageRow = { id: string; name: string; description: string; price_credits: number | null; price_premium_cents: number | null; discount_pct: number | null; is_available: boolean; available_from: string | null; available_until: string | null; created_at: string; updated_at: string; };
  const { data: packages } = listResult<PackageRow>(pkgsRes);
  const pkgSkinMap = new Map<string, string[]>();
  for (const row of pkgItems ?? []) {
    const list = pkgSkinMap.get(row.package_id) ?? [];
    list.push(row.skin_id); pkgSkinMap.set(row.package_id, list);
  }
  const enrichedPackages = (packages ?? []).map((p) => ({ ...p, skinIds: pkgSkinMap.get(p.id) ?? [] }));

  // ── Ship classes ──────────────────────────────────────────────────────────
  type ShipClassRow = { id: string; name: string; description: string; rarity: string; base_speed_ly_per_hr: number; base_cargo_cap: number; max_speed_tier: number | null; max_cargo_tier: number | null; icon_variant: string; purchase_cost_credits: number; is_available: boolean; sort_order: number; };
  const { data: shipClasses } = listResult<ShipClassRow>(shipClassesRes);

  // ── Balance overrides ─────────────────────────────────────────────────────
  type BalanceOverride = { key: string; value: unknown; description: string; updated_at: string; };
  const { data: balanceOverrides } = listResult<BalanceOverride>(balanceRes);

  // ── Live events ───────────────────────────────────────────────────────────
  type EventRow = { id: string; name: string; description: string; type: string; config: Record<string, unknown>; starts_at: string; ends_at: string; is_active: boolean; system_ids: string[] | null; entry_cost_credits: number | null; entry_cost_premium: number | null; created_at: string; updated_at: string; };
  type EventNodeRow = { id: string; event_id: string; resource_type: string; remaining_amount: number; status: string; };
  const { data: events }   = listResult<EventRow>(eventsRes);
  const { data: eventNodes } = listResult<EventNodeRow>(nodesRes);
  const nodesByEvent = new Map<string, EventNodeRow[]>();
  for (const n of eventNodes ?? []) {
    const list = nodesByEvent.get(n.event_id) ?? []; list.push(n); nodesByEvent.set(n.event_id, list);
  }
  const enrichedEvents = (events ?? []).map((e) => ({ ...e, nodes: nodesByEvent.get(e.id) ?? [] }));

  // ── Battle passes ─────────────────────────────────────────────────────────
  type PassRow = { id: string; name: string; description: string; season_number: number; max_tier: number; xp_per_tier: number; starts_at: string; ends_at: string; is_active: boolean; premium_cost_credits: number | null; premium_cost_premium: number | null; };
  type TierRow = { id: string; pass_id: string; tier: number; quest_label: string; quest_type: string; quest_config: Record<string, unknown>; free_reward_type: string; free_reward_config: Record<string, unknown>; premium_reward_type: string | null; premium_reward_config: Record<string, unknown>; };
  const { data: passes } = listResult<PassRow>(passesRes);
  const { data: tiers  } = listResult<TierRow>(tiersRes);
  const tiersByPass = new Map<string, TierRow[]>();
  for (const t of tiers ?? []) {
    const list = tiersByPass.get(t.pass_id) ?? []; list.push(t); tiersByPass.set(t.pass_id, list);
  }
  const enrichedPasses = (passes ?? []).map((p) => ({ ...p, tiers: tiersByPass.get(p.id) ?? [] }));

  return (
    <div className="max-w-5xl space-y-6">
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
        Balance overrides cache for 60 s server-side.
      </div>

      <AdminDevClient
        dbSkins={dbSkins ?? []}
        packages={enrichedPackages}
        allSkinDefs={ALL_SKINS}
        shipClasses={shipClasses ?? []}
        balanceOverrides={balanceOverrides ?? []}
        liveEvents={enrichedEvents}
        battlePasses={enrichedPasses}
      />
    </div>
  );
}
