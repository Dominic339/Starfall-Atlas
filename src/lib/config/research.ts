/**
 * Research system definitions — Phase 10.
 *
 * All research definitions are centralised here. Player unlock state is
 * persisted in the `player_research` table. Nothing else should hardcode
 * research IDs or costs.
 *
 * Categories:
 *   ship_hulls       — hull tier unlocks that raise the total upgrade cap
 *   ship_stat_caps   — per-stat cap progression (Tech I / II / III)
 *   fleet_tech       — scaffold entries for future fleet gameplay
 *   colony_tech      — scaffold entries for future colony buffs
 *
 * Costs are resource-denominated (no credits). Only iron is used in the
 * alpha; expand ResourceCost as new resource types become gatherable.
 *
 * Milestone checks are evaluated server-side in the purchase route using
 * current DB state. Scaffold-only entries can be purchased but have no
 * active gameplay effect yet.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type ResearchCategory =
  | "ship_hulls"
  | "ship_stat_caps"
  | "fleet_tech"
  | "colony_tech";

export type ShipStatKey =
  | "hull"
  | "shield"
  | "cargo"
  | "engine"
  | "turret"
  | "utility";

export type MilestoneRequirement =
  | { type: "min_active_colonies"; count: number }
  | { type: "min_systems_discovered"; count: number }
  | { type: "min_colony_tier"; tier: number };

export interface ResourceCost {
  resource_type: string;
  quantity: number;
}

export interface ResearchDefinition {
  /** Stable string key — stored in player_research.research_id. */
  id: string;
  name: string;
  description: string;
  category: ResearchCategory;
  /** Station resources consumed when unlocked. */
  cost: ResourceCost[];
  /** Research IDs that must be unlocked before this one is purchasable. */
  requires: string[];
  /** Optional world-state conditions that must be met (checked server-side). */
  milestones?: MilestoneRequirement[];
  /**
   * When true, this entry is fully defined and purchasable, but its gameplay
   * effect is not yet active in this version.
   */
  scaffoldOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

export const RESEARCH_CATEGORY_META: Record<
  ResearchCategory,
  { label: string; order: number }
> = {
  ship_hulls:     { label: "Ship Hull Technology",         order: 0 },
  ship_stat_caps: { label: "Ship Systems",                 order: 1 },
  fleet_tech:     { label: "Fleet Technology",             order: 2 },
  colony_tech:    { label: "Colony & Station Technology",  order: 3 },
};

// ---------------------------------------------------------------------------
// Constants referenced by researchHelpers.ts
// ---------------------------------------------------------------------------

/**
 * Max total upgrades on a SINGLE ship when no hull research is unlocked.
 *
 * Phase 29 rebase: ships start at level 1 in hull/engine/shield/utility (total = 4).
 * Phase 30 rebase: cargo and turret are also normalized to level 1 (total = 6).
 * Set to 12 so 6 effective free upgrades remain above the new 6-stat baseline —
 * matching the "6 free upgrades above baseline" intent throughout.
 */
export const BASE_TOTAL_SHIP_UPGRADES = 12;

/**
 * Per-stat upgrade cap when no stat research is unlocked.
 *
 * Phase 29 rebase: ships start at level 1, so the base cap must be ≥ 2
 * to allow the first meaningful upgrade (1→2) without any research.
 */
export const BASE_STAT_CAP = 2;

// ---------------------------------------------------------------------------
// Helpers for building repetitive definitions
// ---------------------------------------------------------------------------

const SHIP_STAT_META: Record<ShipStatKey, { name: string; desc: string }> = {
  hull:    { name: "Hull",    desc: "structural integrity upgrade slots" },
  shield:  { name: "Shield",  desc: "energy shield upgrade slots" },
  cargo:   { name: "Cargo",   desc: "cargo hold upgrade slots" },
  engine:  { name: "Engine",  desc: "propulsion upgrade slots" },
  turret:  { name: "Turret",  desc: "weapons upgrade slots" },
  utility: { name: "Utility", desc: "utility module upgrade slots" },
};

const SHIP_STATS: ShipStatKey[] = [
  "hull", "shield", "cargo", "engine", "turret", "utility",
];

/**
 * Three-tier stat cap progression: [cap, iron cost].
 *
 * Phase 29 rebase: each cap value is +1 from Phase 28 to account for the
 * level-1 baseline. Old caps (3/6/10) corresponded to 3/6/10 upgrades from
 * zero. New caps (4/7/10) allow the same meaningful upgrade headroom above
 * the new level-1 baseline. T3 stays at 10 (absolute max).
 *
 * Costs are substantially increased to match the higher early-game iron income
 * from Phase 28 extraction rebalance (720 u/hr base).
 */
const STAT_TIERS: [number, number][] = [
  [4,  200],  // Tech I   — cap 2 → 4  (first real upgrade unlock)
  [7,  600],  // Tech II  — cap 4 → 7  (mid-game)
  [10, 2000], // Tech III — cap 7 → 10 (late-game, absolute max)
];

function buildStatCapDefs(): ResearchDefinition[] {
  const defs: ResearchDefinition[] = [];
  for (const stat of SHIP_STATS) {
    const meta = SHIP_STAT_META[stat];
    STAT_TIERS.forEach(([cap, iron], i) => {
      const tier = i + 1;
      defs.push({
        id: `${stat}_cap_t${tier}`,
        name: `${meta.name} Tech ${["I", "II", "III"][i]}`,
        description: `Raises the cap on ${meta.desc} to ${cap} per ship.`,
        category: "ship_stat_caps",
        cost: [{ resource_type: "iron", quantity: iron }],
        requires: tier > 1 ? [`${stat}_cap_t${tier - 1}`] : [],
      });
    });
  }
  return defs;
}

function buildSequentialDefs(
  category: ResearchCategory,
  baseName: string,
  baseId: string,
  descriptions: string[],
  ironCosts: number[],
  milestones?: (MilestoneRequirement[] | undefined)[],
  scaffoldOnly = true,
): ResearchDefinition[] {
  return descriptions.map((desc, i) => ({
    id: `${baseId}_${i + 1}`,
    name: `${baseName} ${["I", "II", "III", "IV", "V"][i]}`,
    description: desc,
    category,
    cost: [{ resource_type: "iron", quantity: ironCosts[i] }],
    requires: i > 0 ? [`${baseId}_${i}`] : [],
    milestones: milestones?.[i],
    scaffoldOnly,
  }));
}

// ---------------------------------------------------------------------------
// Research definitions
// ---------------------------------------------------------------------------

export const RESEARCH_DEFS: readonly ResearchDefinition[] = [

  // ── Category 1: Ship Hull Tiers ──────────────────────────────────────────

  {
    id: "ship_hull_t2",
    name: "Tier 2 Hulls",
    description:
      "Advanced alloy frames allow ships to accept more installed modules. " +
      "Raises the per-ship upgrade budget to 17 (6 above the level-1 baseline for all six stats).",
    category: "ship_hulls",
    cost: [{ resource_type: "iron", quantity: 300 }],
    requires: [],
  },
  {
    id: "ship_hull_t3",
    name: "Tier 3 Hulls",
    description:
      "Reinforced composite hulls with integrated conduit routing. " +
      "Raises the per-ship upgrade budget to 29.",
    category: "ship_hulls",
    cost: [{ resource_type: "iron", quantity: 800 }],
    requires: ["ship_hull_t2"],
    milestones: [{ type: "min_active_colonies", count: 1 }],
  },
  {
    id: "ship_hull_t4",
    name: "Tier 4 Hulls",
    description:
      "High-density modular hull sections with redundant power feeds. " +
      "Raises the per-ship upgrade budget to 65.",
    category: "ship_hulls",
    cost: [{ resource_type: "iron", quantity: 2500 }],
    requires: ["ship_hull_t3"],
    milestones: [{ type: "min_active_colonies", count: 3 }],
  },
  {
    id: "ship_hull_t5",
    name: "Tier 5 Hulls",
    description:
      "Nano-lattice construction with exotic material bracing. " +
      "Raises the per-ship upgrade budget to 66.",
    category: "ship_hulls",
    cost: [{ resource_type: "iron", quantity: 8000 }],
    requires: ["ship_hull_t4"],
    milestones: [{ type: "min_active_colonies", count: 5 }],
  },
  {
    id: "antimatter_shielding",
    name: "Antimatter Shielding",
    description:
      "Hardened containment layers capable of withstanding wormhole transit " +
      "stresses. Required for future wormhole access. No active effect yet.",
    category: "ship_hulls",
    cost: [{ resource_type: "iron", quantity: 15000 }],
    requires: ["ship_hull_t5"],
    milestones: [{ type: "min_active_colonies", count: 8 }],
    scaffoldOnly: true,
  },

  // ── Category 2: Ship Stat Caps (generated) ───────────────────────────────
  ...buildStatCapDefs(),

  // ── Category 3: Fleet Technology (scaffold) ──────────────────────────────
  ...buildSequentialDefs(
    "fleet_tech",
    "Fleet Command",
    "fleet_command",
    [
      "Establishes basic multi-ship coordination protocols. Unlocks 1 fleet slot (future).",
      "Expands command bandwidth for larger formations. Unlocks 2 fleet slots (future).",
      "Distributed fleet AI reduces coordination latency. Unlocks 3 fleet slots (future).",
      "Advanced tactical overlay for large-scale operations. Unlocks 4 fleet slots (future).",
      "Full strategic command suite. Unlocks 5 fleet slots (future).",
    ],
    [300, 800, 2000, 5000, 12000],
    [
      undefined,
      [{ type: "min_active_colonies", count: 1 }],
      [{ type: "min_active_colonies", count: 2 }],
      [{ type: "min_active_colonies", count: 4 }],
      [{ type: "min_active_colonies", count: 6 }],
    ],
  ),
  ...buildSequentialDefs(
    "fleet_tech",
    "Fleet Formation",
    "fleet_formation",
    [
      "Basic geometric formations improve fleet cohesion. Allows fleets of 2 ships (future).",
      "Dynamic formation switching during transit. Allows fleets of 4 ships (future).",
      "Adaptive formation AI responds to obstacles. Allows fleets of 8 ships (future).",
      "Staggered micro-jump coordination. Allows fleets of 12 ships (future).",
      "Synchronized formation-jump capability. Allows fleets of 20 ships (future).",
    ],
    [300, 800, 2000, 5000, 12000],
    [
      undefined,
      [{ type: "min_active_colonies", count: 1 }],
      [{ type: "min_active_colonies", count: 2 }],
      [{ type: "min_active_colonies", count: 4 }],
      [{ type: "min_active_colonies", count: 6 }],
    ],
  ),

  // ── Category 4: Colony & Station Technology ──────────────────────────────

  // Phase 16: unlock volcanic/toxic colonization + iron dome maintenance.
  {
    id: "harsh_colony_environment",
    name: "Harsh Colony Environment",
    description:
      "Pressurized habitat domes, thermal-regulation systems, and chemical " +
      "shielding allow colonization of volcanic and toxic worlds. " +
      "Required before founding colonies on these planet types. " +
      "Harsh colonies consume additional iron each period for dome maintenance.",
    category: "colony_tech",
    cost: [{ resource_type: "iron", quantity: 500 }],
    requires: ["sustainability_1"],
    milestones: [{ type: "min_active_colonies", count: 1 }],
  },

  ...buildSequentialDefs(
    "colony_tech",
    "Extraction",
    "extraction",
    [
      "Improved drilling protocols increase raw resource yield by 10% (future).",
      "Automated extraction rigs run continuously with minimal downtime (future).",
      "Deep-core extraction reaches richer ore seams (future).",
      "Particle-sieve refinery improves ore grade before shipping (future).",
      "Quantum-stabilised extraction at near-theoretical efficiency limits (future).",
    ],
    [200, 600, 1500, 4000, 10000],
  ),
  ...buildSequentialDefs(
    "colony_tech",
    "Growth",
    "growth",
    [
      "Improved habitat construction standards accelerate population growth (future).",
      "Advanced agricultural systems support larger populations (future).",
      "Synthetic food production removes environmental growth limits (future).",
      "Distributed healthcare networks extend healthy lifespans (future).",
      "Post-scarcity welfare systems maximise population satisfaction (future).",
    ],
    [200, 600, 1500, 4000, 10000],
  ),
  ...buildSequentialDefs(
    "colony_tech",
    "Sustainability",
    "sustainability",
    [
      "Efficient iron recycling reduces upkeep consumption by 10% (future).",
      "Closed-loop life support further reduces upkeep overhead (future).",
      "Fusion power eliminates dependency on imported fuel (future).",
      "Fully self-sustaining colony cycles — minimal iron upkeep (future).",
      "Zero-net-import colony design. Upkeep requirements near zero (future).",
    ],
    [200, 600, 1500, 4000, 10000],
  ),
  ...buildSequentialDefs(
    "colony_tech",
    "Storage",
    "storage",
    [
      "Prefabricated storage units increase colony storage cap (future).",
      "Automated warehouse systems double effective storage volume (future).",
      "Orbital container platforms massively expand capacity (future).",
      "Distributed micro-warehouse grid across all colony bodies (future).",
      "Planetary-scale storage network — effectively unlimited (future).",
    ],
    [200, 600, 1500, 4000, 10000],
  ),
] as const;

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Fast lookup map: id → ResearchDefinition */
export const RESEARCH_BY_ID: ReadonlyMap<string, ResearchDefinition> = new Map(
  RESEARCH_DEFS.map((d) => [d.id, d]),
);

/** All research IDs grouped by category, in definition order. */
export const RESEARCH_IDS_BY_CATEGORY: ReadonlyMap<
  ResearchCategory,
  string[]
> = (() => {
  const map = new Map<ResearchCategory, string[]>();
  for (const def of RESEARCH_DEFS) {
    const list = map.get(def.category) ?? [];
    list.push(def.id);
    map.set(def.category, list);
  }
  return map;
})();
