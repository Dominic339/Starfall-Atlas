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
  type ResearchDefinition,
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
import { ResearchCard } from "./_components/ResearchCard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Research Lab — Starfall Atlas",
};

// ---------------------------------------------------------------------------
// Presentation helpers (page-only, no backend impact)
// ---------------------------------------------------------------------------

interface SubGroup {
  id: string;
  label: string;
  defs: ResearchDefinition[];
}

function getSubGroups(
  category: ResearchCategory,
  defs: ResearchDefinition[],
): SubGroup[] {
  switch (category) {
    case "ship_hulls":
      return [{ id: "hulls", label: "Hull Tier Progression", defs }];

    case "ship_stat_caps": {
      const STATS = [
        "hull", "shield", "cargo", "engine", "turret", "utility",
      ] as const;
      return STATS.map((stat) => ({
        id: stat,
        label: stat.charAt(0).toUpperCase() + stat.slice(1),
        defs: defs.filter((d) => d.id.startsWith(`${stat}_cap_`)),
      }));
    }

    case "fleet_tech":
      return [
        {
          id: "fleet_command",
          label: "Fleet Command",
          defs: defs.filter((d) => d.id.startsWith("fleet_command_")),
        },
        {
          id: "fleet_formation",
          label: "Fleet Formation",
          defs: defs.filter((d) => d.id.startsWith("fleet_formation_")),
        },
      ];

    case "colony_tech":
      return [
        {
          id: "extraction",
          label: "Extraction",
          defs: defs.filter((d) => d.id.startsWith("extraction_")),
        },
        {
          id: "sustainability",
          label: "Sustainability",
          defs: defs.filter((d) => d.id.startsWith("sustainability_")),
        },
        {
          id: "storage",
          label: "Storage",
          defs: defs.filter((d) => d.id.startsWith("storage_")),
        },
        {
          id: "growth",
          label: "Growth",
          defs: defs.filter((d) => d.id.startsWith("growth_")),
        },
        {
          id: "harsh",
          label: "Special Research",
          defs: defs.filter((d) => d.id === "harsh_colony_environment"),
        },
      ];

    default:
      return [{ id: "default", label: "", defs }];
  }
}

function getTierLabel(id: string): string {
  const hullMatch = id.match(/^ship_hull_t(\d)$/);
  if (hullMatch) return `T${hullMatch[1]}`;
  if (id === "antimatter_shielding") return "AMS";

  const capMatch = id.match(/_cap_t(\d)$/);
  if (capMatch) {
    const t = parseInt(capMatch[1], 10);
    return ["I", "II", "III"][t - 1] ?? `T${t}`;
  }

  const seqMatch = id.match(/_(\d+)$/);
  if (seqMatch) {
    const n = parseInt(seqMatch[1], 10);
    return ["I", "II", "III", "IV", "V"][n - 1] ?? String(n);
  }

  return "";
}

const CATEGORY_DESCRIPTIONS: Record<ResearchCategory, string> = {
  ship_hulls:
    "Unlock larger hull frames to expand your per-ship upgrade budget.",
  ship_stat_caps:
    "Raise the maximum level cap for each individual ship stat.",
  fleet_tech:
    "Multi-ship fleet coordination and formation capabilities. (Coming soon)",
  colony_tech:
    "Boost extraction yield, reduce upkeep costs, and expand colony storage.",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

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

  const unlockedRows =
    listResult<Pick<PlayerResearch, "research_id">>(researchRes).data ?? [];
  const unlockedIds = new Set(unlockedRows.map((r) => r.research_id));

  const activeColonies = (coloniesRes.data ?? []) as {
    population_tier: number;
  }[];
  const milestoneData: MilestoneData = {
    activeColonyCount: activeColonies.length,
    systemsDiscovered: (discoveriesRes.data ?? []).length,
    maxColonyTier: activeColonies.reduce(
      (max, c) => Math.max(max, c.population_tier),
      0,
    ),
  };

  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;

  // ── Step 3: station inventory (needed to show "have X / need Y") ──────────
  let stationInvMap = new Map<string, number>();
  if (station) {
    const { data: invRows } = listResult<
      Pick<ResourceInventoryRow, "resource_type" | "quantity">
    >(
      await admin
        .from("resource_inventory")
        .select("resource_type, quantity")
        .eq("location_type", "station")
        .eq("location_id", station.id),
    );
    stationInvMap = new Map(
      (invRows ?? []).map((r) => [r.resource_type, r.quantity]),
    );
  }

  // ── Derived: progression summary ─────────────────────────────────────────
  const totalUpgradeCap = maxTotalShipUpgrades(unlockedIds);
  const statCaps = allStatCaps(unlockedIds);
  const stationIron = stationInvMap.get("iron") ?? 0;

  // ── Group research by category in display order ───────────────────────────
  const orderedCategories = (
    Object.entries(RESEARCH_CATEGORY_META) as [
      ResearchCategory,
      { label: string; order: number },
    ][]
  ).sort((a, b) => a[1].order - b[1].order);

  const defsByCategory = new Map<ResearchCategory, ResearchDefinition[]>();
  for (const def of RESEARCH_DEFS) {
    const list = defsByCategory.get(def.category) ?? [];
    list.push(def);
    defsByCategory.set(def.category, list);
  }

  const STAT_KEYS = [
    "hull", "shield", "cargo", "engine", "turret", "utility",
  ] as const;

  // Max possible total upgrades (T5 hull)
  const MAX_TOTAL_UPGRADES = 66;

  return (
    <div className="space-y-8 pb-8">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
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

      {/* ── Progression Summary ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden">
        <div className="border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Ship Progression Summary
          </p>
          <span className="text-xs text-zinc-500">
            Station iron:{" "}
            <span className="font-mono text-zinc-300">
              {stationIron.toLocaleString("en-US")}
            </span>
          </span>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* Upgrade budget */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-500">
                Upgrade budget per ship
              </span>
              <span className="text-xs font-mono text-zinc-200">
                {totalUpgradeCap}{" "}
                <span className="text-zinc-600">/ {MAX_TOTAL_UPGRADES} max</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{
                  width: `${Math.round((totalUpgradeCap / MAX_TOTAL_UPGRADES) * 100)}%`,
                }}
              />
            </div>
          </div>

          {/* Per-stat caps grid */}
          <div>
            <p className="text-xs text-zinc-600 mb-1.5">Per-stat level caps</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {STAT_KEYS.map((stat) => {
                const cap = statCaps[stat];
                // Tiers: base=2, T1=4, T2=7, T3=10 → 4 states → 3 research tiers
                const tiersFilled =
                  cap >= 10 ? 3 : cap >= 7 ? 2 : cap >= 4 ? 1 : 0;
                return (
                  <div
                    key={stat}
                    className="flex flex-col items-center gap-1 rounded-md bg-zinc-800/50 px-2 py-1.5"
                  >
                    <span className="text-xs text-zinc-500 uppercase tracking-wider">
                      {stat.slice(0, 3)}
                    </span>
                    <span className="font-mono text-sm font-semibold text-zinc-200">
                      {cap}
                    </span>
                    <div className="flex gap-0.5">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full ${
                            i < tiersFilled
                              ? "bg-indigo-500"
                              : "bg-zinc-700"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Research Categories ──────────────────────────────────────────────── */}
      {orderedCategories.map(([category, meta]) => {
        const defs = defsByCategory.get(category) ?? [];
        const subGroups = getSubGroups(category, defs);

        // Count for the header badge
        const unlockedCount = defs.filter((d) => unlockedIds.has(d.id)).length;

        return (
          <section
            key={category}
            className="rounded-xl border border-zinc-700 overflow-hidden"
          >
            {/* Category header */}
            <div className="bg-zinc-800/60 border-b border-zinc-700 px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-200">
                  {meta.label}
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {CATEGORY_DESCRIPTIONS[category]}
                </p>
              </div>
              <span className="shrink-0 text-xs font-mono text-zinc-500 bg-zinc-800 rounded px-2 py-0.5">
                {unlockedCount}/{defs.length}
              </span>
            </div>

            {/* Sub-groups */}
            <div className="divide-y divide-zinc-800/60">
              {subGroups
                .filter((sg) => sg.defs.length > 0)
                .map((subGroup) => {
                  return (
                    <div key={subGroup.id} className="px-4 py-3">
                      {/* Sub-group label (only when there are multiple) */}
                      {subGroups.filter((sg) => sg.defs.length > 0).length >
                        1 && (
                        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                          {subGroup.label}
                        </p>
                      )}

                      {/* Progression chain — horizontal scroll on overflow */}
                      <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
                        {subGroup.defs.map((def, idx) => {
                          const status = researchStatus(
                            def,
                            unlockedIds,
                            milestoneData,
                          );
                          const prereqsMet = arePrerequisitesMet(
                            def,
                            unlockedIds,
                          );
                          const milestonesMet = areMilestonesMet(
                            def.milestones ?? [],
                            milestoneData,
                          );
                          const costLabel = def.cost
                            .map((c) => `${c.quantity.toLocaleString("en-US")} ${c.resource_type}`)
                            .join(", ");
                          const canAfford =
                            station !== null &&
                            def.cost.every(
                              (c) =>
                                (stationInvMap.get(c.resource_type) ?? 0) >=
                                c.quantity,
                            );
                          const blockingPrereqNames = def.requires
                            .filter((id) => !unlockedIds.has(id))
                            .map((id) => {
                              const d = RESEARCH_DEFS.find((r) => r.id === id);
                              return d?.name ?? id;
                            });
                          const blockingMilestoneLabels = (
                            def.milestones ?? []
                          )
                            .filter((m) => {
                              switch (m.type) {
                                case "min_active_colonies":
                                  return (
                                    milestoneData.activeColonyCount < m.count
                                  );
                                case "min_systems_discovered":
                                  return (
                                    milestoneData.systemsDiscovered < m.count
                                  );
                                case "min_colony_tier":
                                  return (
                                    milestoneData.maxColonyTier < m.tier
                                  );
                              }
                            })
                            .map(milestoneLabel);

                          return (
                            <div
                              key={def.id}
                              className="flex items-stretch shrink-0"
                            >
                              <ResearchCard
                                def={def}
                                status={status}
                                canAfford={canAfford}
                                prereqsMet={prereqsMet}
                                milestonesMet={milestonesMet}
                                blockingPrereqNames={blockingPrereqNames}
                                blockingMilestoneLabels={
                                  blockingMilestoneLabels
                                }
                                costLabel={costLabel}
                                tierLabel={getTierLabel(def.id)}
                              />
                              {/* Connector arrow between items in chain */}
                              {idx < subGroup.defs.length - 1 && (
                                <div className="flex items-center px-1.5 shrink-0 self-center">
                                  <span className="text-zinc-700 text-sm select-none">
                                    →
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
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
