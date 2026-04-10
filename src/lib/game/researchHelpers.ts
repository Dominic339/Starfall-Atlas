/**
 * Research helper utilities — Phase 10.
 *
 * Pure functions that answer ship/fleet progression questions from a player's
 * set of unlocked research IDs. These are the single source of truth for
 * future ship upgrade and fleet logic; no other code should re-derive these
 * values from scratch.
 *
 * All functions accept `unlockedIds: ReadonlySet<string>` or `string[]`
 * (both forms are common at call sites).
 */

import {
  BASE_TOTAL_SHIP_UPGRADES,
  BASE_STAT_CAP,
  RESEARCH_BY_ID,
  type ShipStatKey,
  type MilestoneRequirement,
  type ResearchDefinition,
} from "@/lib/config/research";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Data the purchase route and research page must supply for milestone checks. */
export interface MilestoneData {
  activeColonyCount: number;
  systemsDiscovered: number;
  /** Highest population_tier across all active colonies (0 if none). */
  maxColonyTier: number;
}

// ---------------------------------------------------------------------------
// Core unlock queries
// ---------------------------------------------------------------------------

export function isResearchUnlocked(
  researchId: string,
  unlockedIds: ReadonlySet<string> | string[],
): boolean {
  const set =
    Array.isArray(unlockedIds) ? new Set(unlockedIds) : unlockedIds;
  return set.has(researchId);
}

/**
 * True when the research exists, is not already unlocked, its prerequisites
 * are met, its milestone conditions are satisfied, AND it is not scaffold-only.
 *
 * Scaffold-only entries are defined and costed but have no active gameplay
 * effect. They must not be purchasable until that effect is implemented.
 */
export function isResearchPurchasable(
  def: ResearchDefinition,
  unlockedIds: ReadonlySet<string>,
  milestones: MilestoneData,
): boolean {
  if (unlockedIds.has(def.id)) return false;
  if (def.scaffoldOnly) return false;
  if (!arePrerequisitesMet(def, unlockedIds)) return false;
  if (!areMilestonesMet(def.milestones ?? [], milestones)) return false;
  return true;
}

export function arePrerequisitesMet(
  def: ResearchDefinition,
  unlockedIds: ReadonlySet<string>,
): boolean {
  return def.requires.every((id) => unlockedIds.has(id));
}

export function areMilestonesMet(
  milestones: MilestoneRequirement[],
  data: MilestoneData,
): boolean {
  return milestones.every((m) => {
    switch (m.type) {
      case "min_active_colonies":
        return data.activeColonyCount >= m.count;
      case "min_systems_discovered":
        return data.systemsDiscovered >= m.count;
      case "min_colony_tier":
        return data.maxColonyTier >= m.tier;
    }
  });
}

/** Human-readable description of a single milestone requirement. */
export function milestoneLabel(m: MilestoneRequirement): string {
  switch (m.type) {
    case "min_active_colonies":
      return `${m.count} active colon${m.count === 1 ? "y" : "ies"}`;
    case "min_systems_discovered":
      return `${m.count} system${m.count === 1 ? "" : "s"} discovered`;
    case "min_colony_tier":
      return `colony at Tier ${m.tier}`;
  }
}

// ---------------------------------------------------------------------------
// Ship progression helpers
// ---------------------------------------------------------------------------

/**
 * Maximum total upgrade points allowed on a SINGLE ship (not a global pool).
 * Each ship is an independent asset and enforces this cap individually.
 *
 * Baseline (no hull research): BASE_TOTAL_SHIP_UPGRADES (12)
 * T2 → 17, T3 → 29, T4 → 65, T5 → 66.
 *
 * Phase 29 rebase: +4 to each tier (hull/engine/shield/utility at level 1 = total 4).
 * Phase 30 rebase: +2 more to each tier (cargo/turret also normalized to level 1 = total 6).
 */
export function maxTotalShipUpgrades(
  unlockedIds: ReadonlySet<string> | string[],
): number {
  const set = Array.isArray(unlockedIds) ? new Set(unlockedIds) : unlockedIds;
  if (set.has("ship_hull_t5")) return 66;
  if (set.has("ship_hull_t4")) return 65;
  if (set.has("ship_hull_t3")) return 29;
  if (set.has("ship_hull_t2")) return 17;
  return BASE_TOTAL_SHIP_UPGRADES;
}

/**
 * Maximum allowed upgrade level for a specific ship stat ON A SINGLE SHIP.
 * Applied per-ship — each ship enforces this cap independently.
 *
 * Baseline (no stat research): BASE_STAT_CAP (2)
 * Tech I → 4, Tech II → 7, Tech III → 10.
 *
 * Phase 29 rebase: caps +1 each tier (3/6/10 → 4/7/10) since ships start
 * at level 1 — preserves the same upgrade headroom above the baseline.
 */
export function maxStatLevel(
  stat: ShipStatKey,
  unlockedIds: ReadonlySet<string> | string[],
): number {
  const set = Array.isArray(unlockedIds) ? new Set(unlockedIds) : unlockedIds;
  if (set.has(`${stat}_cap_t3`)) return 10;
  if (set.has(`${stat}_cap_t2`)) return 7;
  if (set.has(`${stat}_cap_t1`)) return 4;
  return BASE_STAT_CAP;
}

/**
 * All per-stat caps for a player, as a record keyed by ShipStatKey.
 * Convenience wrapper around maxStatLevel.
 */
export function allStatCaps(
  unlockedIds: ReadonlySet<string> | string[],
): Record<ShipStatKey, number> {
  const set = Array.isArray(unlockedIds) ? new Set(unlockedIds) : unlockedIds;
  return {
    hull:    maxStatLevel("hull",    set),
    shield:  maxStatLevel("shield",  set),
    cargo:   maxStatLevel("cargo",   set),
    engine:  maxStatLevel("engine",  set),
    turret:  maxStatLevel("turret",  set),
    utility: maxStatLevel("utility", set),
  };
}

// ---------------------------------------------------------------------------
// Fleet helpers (scaffold — not yet active gameplay)
// ---------------------------------------------------------------------------

/**
 * Number of fleet slots the player may command.
 * Driven by Fleet Command research. Returns 0 until fleet gameplay is active.
 *
 * Fleet Command I–V → 1, 2, 3, 4, 5 slots.
 */
export function fleetSlotsAllowed(
  unlockedIds: ReadonlySet<string> | string[],
): number {
  const set = Array.isArray(unlockedIds) ? new Set(unlockedIds) : unlockedIds;
  if (set.has("fleet_command_5")) return 5;
  if (set.has("fleet_command_4")) return 4;
  if (set.has("fleet_command_3")) return 3;
  if (set.has("fleet_command_2")) return 2;
  if (set.has("fleet_command_1")) return 1;
  return 0;
}

/**
 * Maximum number of ships per fleet.
 * Driven by Fleet Formation research. Returns 0 until fleet gameplay is active.
 *
 * Formation I–V → 2, 4, 8, 12, 20 ships per fleet.
 */
export function fleetSizeAllowed(
  unlockedIds: ReadonlySet<string> | string[],
): number {
  const set = Array.isArray(unlockedIds) ? new Set(unlockedIds) : unlockedIds;
  if (set.has("fleet_formation_5")) return 20;
  if (set.has("fleet_formation_4")) return 12;
  if (set.has("fleet_formation_3")) return 8;
  if (set.has("fleet_formation_2")) return 4;
  if (set.has("fleet_formation_1")) return 2;
  return 0;
}

// ---------------------------------------------------------------------------
// Bulk research status (used by the research page)
// ---------------------------------------------------------------------------

export type ResearchStatus = "unlocked" | "purchasable" | "locked";

export function researchStatus(
  def: ResearchDefinition,
  unlockedIds: ReadonlySet<string>,
  milestones: MilestoneData,
): ResearchStatus {
  if (unlockedIds.has(def.id)) return "unlocked";
  if (isResearchPurchasable(def, unlockedIds, milestones)) return "purchasable";
  return "locked";
}

// ---------------------------------------------------------------------------
// Research lookup (re-exported for convenience)
// ---------------------------------------------------------------------------

export { RESEARCH_BY_ID };
