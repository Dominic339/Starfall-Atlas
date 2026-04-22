/**
 * GET /api/game/research/panel
 *
 * Returns fully-computed research tree data for the map overlay panel.
 * All status logic (unlocked/purchasable/locked, affordability, milestones)
 * is resolved server-side so the client is pure presentation.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
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
import type { PlayerResearch, PlayerStation, ResourceInventoryRow } from "@/lib/types/game";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers (mirrors research page logic)
// ---------------------------------------------------------------------------

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

function getSubGroups(category: ResearchCategory, defs: ResearchDefinition[]) {
  switch (category) {
    case "ship_hulls":
      return [{ id: "hulls", label: "Hull Tier Progression", defs }];
    case "ship_stat_caps": {
      const STATS = ["hull", "shield", "cargo", "engine", "turret", "utility"] as const;
      return STATS.map((stat) => ({
        id: stat,
        label: stat.charAt(0).toUpperCase() + stat.slice(1),
        defs: defs.filter((d) => d.id.startsWith(`${stat}_cap_`)),
      }));
    }
    case "fleet_tech":
      return [
        { id: "fleet_command",   label: "Fleet Command",   defs: defs.filter((d) => d.id.startsWith("fleet_command_")) },
        { id: "fleet_formation", label: "Fleet Formation", defs: defs.filter((d) => d.id.startsWith("fleet_formation_")) },
      ];
    case "colony_tech":
      return [
        { id: "extraction",     label: "Extraction",      defs: defs.filter((d) => d.id.startsWith("extraction_")) },
        { id: "sustainability", label: "Sustainability",  defs: defs.filter((d) => d.id.startsWith("sustainability_")) },
        { id: "storage",        label: "Storage",         defs: defs.filter((d) => d.id.startsWith("storage_")) },
        { id: "growth",         label: "Growth",          defs: defs.filter((d) => d.id.startsWith("growth_")) },
        { id: "harsh",          label: "Special",         defs: defs.filter((d) => d.id === "harsh_colony_environment") },
      ];
    default:
      return [{ id: "default", label: "", defs }];
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [researchRes, coloniesRes, discoveriesRes, stationRes] = await Promise.all([
    admin.from("player_research").select("research_id").eq("player_id", player.id),
    admin.from("colonies").select("population_tier").eq("owner_id", player.id).eq("status", "active"),
    admin.from("system_discoveries").select("id").eq("player_id", player.id),
    admin.from("player_stations").select("id").eq("owner_id", player.id).maybeSingle(),
  ]);

  const unlockedIds = new Set(
    (listResult<Pick<PlayerResearch, "research_id">>(researchRes).data ?? []).map((r) => r.research_id),
  );

  const activeColonies = (coloniesRes.data ?? []) as { population_tier: number }[];
  const milestoneData: MilestoneData = {
    activeColonyCount: activeColonies.length,
    systemsDiscovered: (discoveriesRes.data ?? []).length,
    maxColonyTier: activeColonies.reduce((max, c) => Math.max(max, c.population_tier), 0),
  };

  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;
  const stationInvMap = new Map<string, number>();
  if (station) {
    const { data: invRows } = listResult<Pick<ResourceInventoryRow, "resource_type" | "quantity">>(
      await admin
        .from("resource_inventory")
        .select("resource_type, quantity")
        .eq("location_type", "station")
        .eq("location_id", station.id),
    );
    for (const r of invRows ?? []) stationInvMap.set(r.resource_type, r.quantity);
  }

  const stationIron = stationInvMap.get("iron") ?? 0;
  const totalUpgradeCap = maxTotalShipUpgrades(unlockedIds);
  const statCaps = allStatCaps(unlockedIds);

  // Build denormalized category tree
  const orderedCategories = (
    Object.entries(RESEARCH_CATEGORY_META) as [ResearchCategory, { label: string; order: number }][]
  ).sort((a, b) => a[1].order - b[1].order);

  const defsByCategory = new Map<ResearchCategory, ResearchDefinition[]>();
  for (const def of RESEARCH_DEFS) {
    const list = defsByCategory.get(def.category) ?? [];
    list.push(def);
    defsByCategory.set(def.category, list);
  }

  const categories = orderedCategories.map(([category, meta]) => {
    const defs = defsByCategory.get(category) ?? [];
    const subGroups = getSubGroups(category, defs)
      .filter((sg) => sg.defs.length > 0)
      .map((sg) => ({
        id: sg.id,
        label: sg.label,
        items: sg.defs.map((def) => {
          const status = researchStatus(def, unlockedIds, milestoneData);
          const prereqsMet = arePrerequisitesMet(def, unlockedIds);
          const msMet = areMilestonesMet(def.milestones ?? [], milestoneData);
          const canAfford = station !== null && def.cost.every(
            (c) => (stationInvMap.get(c.resource_type) ?? 0) >= c.quantity,
          );
          const blockingPrereqNames = def.requires
            .filter((id) => !unlockedIds.has(id))
            .map((id) => RESEARCH_DEFS.find((r) => r.id === id)?.name ?? id);
          const blockingMilestoneLabels = (def.milestones ?? [])
            .filter((m) => {
              switch (m.type) {
                case "min_active_colonies": return milestoneData.activeColonyCount < m.count;
                case "min_systems_discovered": return milestoneData.systemsDiscovered < m.count;
                case "min_colony_tier": return milestoneData.maxColonyTier < m.tier;
              }
            })
            .map(milestoneLabel);

          return {
            id: def.id,
            name: def.name,
            description: def.description,
            tierLabel: getTierLabel(def.id),
            costLabel: def.cost.map((c) => `${c.quantity.toLocaleString()} ${c.resource_type}`).join(", "),
            status,
            canAfford,
            prereqsMet,
            milestonesMet: msMet,
            blockingPrereqNames,
            blockingMilestoneLabels,
            scaffoldOnly: !!def.scaffoldOnly,
          };
        }),
      }));

    return {
      id: category,
      label: meta.label,
      unlockedCount: defs.filter((d) => unlockedIds.has(d.id)).length,
      totalCount: defs.length,
      subGroups,
    };
  });

  return Response.json({
    ok: true,
    data: {
      categories,
      stationIron,
      totalUpgradeCap,
      maxTotalUpgrades: 66,
      statCaps,
    },
  });
}
