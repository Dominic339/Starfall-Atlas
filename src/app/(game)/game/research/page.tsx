/**
 * Research Lab — /game/research
 *
 * Shows all research categories and entries. Resolves player unlock state,
 * milestone data, and station inventory server-side so the client receives
 * a fully-hydrated view.
 *
 * Entry states:
 *   unlocked    — already researched (green checkmark)
 *   purchasable — all prerequisites and milestones met, station has resources
 *                 (bright, shows PurchaseButton)
 *   locked      — prerequisites or milestones not yet met (grey, shows what
 *                 is blocking)
 *
 * Scaffold-only entries show a "(Future)" tag to indicate no active effect.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import {
  RESEARCH_DEFS,
  RESEARCH_CATEGORY_META,
  type ResearchCategory,
} from "@/lib/config/research";
import {
  researchStatus,
  arePrerequisitesMet,
  areMilestonesMet,
  milestoneLabel,
  maxTotalShipUpgrades,
  allStatCaps,
  type MilestoneData,
} from "@/lib/game/researchHelpers";
import type { Player, PlayerResearch, PlayerStation, ResourceInventoryRow } from "@/lib/types/game";
import type { ResearchDefinition } from "@/lib/config/research";
import { PurchaseButton } from "./_components/PurchaseButton";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Research Lab — Starfall Atlas",
};

export default async function ResearchPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // ── Step 1: player ────────────────────────────────────────────────────────
  const { data: player } = maybeSingleResult<Player>(
    await admin
      .from("players")
      .select("id")
      .eq("auth_id", user.id)
      .maybeSingle(),
  );
  if (!player) redirect("/login");

  // ── Step 2: parallel fetch — unlocked research + milestone data + inventory
  const [researchRes, coloniesRes, discoveriesRes, stationRes] =
    await Promise.all([
      admin
        .from("player_research")
        .select("research_id")
        .eq("player_id", player.id),
      admin
        .from("colonies")
        .select("population_tier")
        .eq("owner_id", player.id)
        .eq("status", "active"),
      admin
        .from("system_discoveries")
        .select("id")
        .eq("player_id", player.id),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any)
        .from("player_stations")
        .select("id")
        .eq("owner_id", player.id)
        .maybeSingle(),
    ]);

  const unlockedRows = listResult<Pick<PlayerResearch, "research_id">>(researchRes).data ?? [];
  const unlockedIds = new Set(unlockedRows.map((r) => r.research_id));

  const activeColonies = (coloniesRes.data ?? []) as { population_tier: number }[];
  const milestoneData: MilestoneData = {
    activeColonyCount: activeColonies.length,
    systemsDiscovered: (discoveriesRes.data ?? []).length,
    maxColonyTier: activeColonies.reduce((max, c) => Math.max(max, c.population_tier), 0),
  };

  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;

  // ── Step 3: station inventory (needed to show "have X / need Y") ──────────
  let stationInvMap = new Map<string, number>();
  if (station) {
    const { data: invRows } = listResult<Pick<ResourceInventoryRow, "resource_type" | "quantity">>(
      await admin
        .from("resource_inventory")
        .select("resource_type, quantity")
        .eq("location_type", "station")
        .eq("location_id", station.id),
    );
    stationInvMap = new Map((invRows ?? []).map((r) => [r.resource_type, r.quantity]));
  }

  // ── Derived: progression summary ─────────────────────────────────────────
  const totalUpgradeCap = maxTotalShipUpgrades(unlockedIds);
  const statCaps = allStatCaps(unlockedIds);

  // ── Group research by category in display order ───────────────────────────
  const orderedCategories = (
    Object.entries(RESEARCH_CATEGORY_META) as [ResearchCategory, { label: string; order: number }][]
  ).sort((a, b) => a[1].order - b[1].order);

  const defsByCategory = new Map<ResearchCategory, ResearchDefinition[]>();
  for (const def of RESEARCH_DEFS) {
    const list = defsByCategory.get(def.category) ?? [];
    list.push(def);
    defsByCategory.set(def.category, list);
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Research Lab</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Spend station iron to unlock permanent upgrades.
          </p>
        </div>
        <Link
          href="/game/command"
          className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← Command Centre
        </Link>
      </div>

      {/* Progression summary */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-2">
          Current Progression
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
          <span>
            Total upgrade budget:{" "}
            <span className="font-mono text-zinc-200">{totalUpgradeCap}</span>
          </span>
          {(["hull", "shield", "cargo", "engine", "turret", "utility"] as const).map((s) => (
            <span key={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)} cap:{" "}
              <span className="font-mono text-zinc-200">{statCaps[s]}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Station iron: <span className="font-mono text-zinc-400">
            {(stationInvMap.get("iron") ?? 0).toLocaleString()}
          </span>
        </p>
      </div>

      {/* Categories */}
      {orderedCategories.map(([category, meta]) => {
        const defs = defsByCategory.get(category) ?? [];
        return (
          <section key={category}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              {meta.label}
            </h2>
            <div className="space-y-2">
              {defs.map((def) => {
                const status = researchStatus(def, unlockedIds, milestoneData);
                const prereqsMet = arePrerequisitesMet(def, unlockedIds);
                const milestonesMet = areMilestonesMet(def.milestones ?? [], milestoneData);

                // Cost display
                const costLabel = def.cost
                  .map((c) => `${c.quantity} ${c.resource_type}`)
                  .join(", ");

                // Can afford?
                const canAfford =
                  station !== null &&
                  def.cost.every(
                    (c) => (stationInvMap.get(c.resource_type) ?? 0) >= c.quantity,
                  );

                const isPurchasable = status === "purchasable" && canAfford;

                // Border colour by status
                const borderClass =
                  status === "unlocked"
                    ? "border-emerald-900"
                    : status === "purchasable" && canAfford
                      ? "border-indigo-800"
                      : "border-zinc-800";

                return (
                  <div
                    key={def.id}
                    className={`rounded-lg border bg-zinc-900 px-4 py-3 ${borderClass}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {/* Name + tags */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-sm font-medium ${
                            status === "unlocked"
                              ? "text-emerald-300"
                              : status === "purchasable" && canAfford
                                ? "text-zinc-100"
                                : "text-zinc-500"
                          }`}>
                            {def.name}
                          </p>
                          {status === "unlocked" && (
                            <span className="rounded-full bg-emerald-900/60 px-1.5 py-0.5 text-xs text-emerald-400">
                              Unlocked
                            </span>
                          )}
                          {def.scaffoldOnly && (
                            <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">
                              Future
                            </span>
                          )}
                        </div>

                        {/* Description */}
                        <p className="mt-0.5 text-xs text-zinc-500">{def.description}</p>

                        {/* Blocking reasons when locked */}
                        {status === "locked" && (
                          <div className="mt-1 space-y-0.5">
                            {!prereqsMet && (
                              <p className="text-xs text-amber-600">
                                Requires:{" "}
                                {def.requires
                                  .filter((id) => !unlockedIds.has(id))
                                  .map((id) => {
                                    const d = RESEARCH_DEFS.find((r) => r.id === id);
                                    return d?.name ?? id;
                                  })
                                  .join(", ")}
                              </p>
                            )}
                            {prereqsMet && !milestonesMet && (
                              <p className="text-xs text-amber-600">
                                Milestone:{" "}
                                {(def.milestones ?? [])
                                  .filter((m) => {
                                    switch (m.type) {
                                      case "min_active_colonies":
                                        return milestoneData.activeColonyCount < m.count;
                                      case "min_systems_discovered":
                                        return milestoneData.systemsDiscovered < m.count;
                                      case "min_colony_tier":
                                        return milestoneData.maxColonyTier < m.tier;
                                    }
                                  })
                                  .map(milestoneLabel)
                                  .join(", ")}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Purchasable but can't afford */}
                        {status === "purchasable" && !canAfford && (
                          <p className="mt-1 text-xs text-amber-600">
                            Insufficient resources — need {costLabel}
                          </p>
                        )}
                      </div>

                      {/* Right side: cost + button */}
                      {status !== "unlocked" && (
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-zinc-500">{costLabel}</p>
                          {isPurchasable && (
                            <PurchaseButton
                              researchId={def.id}
                              costLabel={costLabel}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
