/**
 * Ship upgrade helpers — Phase 11.
 *
 * Pure functions only (no DB access). All upgrade logic, tier derivation,
 * and effective-stat computation lives here so the upgrade route, dashboard,
 * and future systems share a single source of truth.
 *
 * Per-ship model (Phase 11 correction):
 *   - maxTotalShipUpgrades(research) → max upgrade points on ONE ship
 *   - maxStatLevel(stat, research)   → max level for ONE stat on ONE ship
 *   Ships are independent; there is no shared global upgrade pool.
 */

import { BALANCE } from "@/lib/config/balance";
import { maxTotalShipUpgrades, maxStatLevel } from "@/lib/game/researchHelpers";
import type { Ship } from "@/lib/types/game";
import type { ShipStatKey } from "@/lib/config/research";

// ---------------------------------------------------------------------------
// Stat key helpers
// ---------------------------------------------------------------------------

export const SHIP_STAT_KEYS: ShipStatKey[] = [
  "hull", "shield", "cargo", "engine", "turret", "utility",
];

export const SHIP_STAT_LABELS: Record<ShipStatKey, string> = {
  hull:    "Hull",
  shield:  "Shield",
  cargo:   "Cargo",
  engine:  "Engine",
  turret:  "Turret",
  utility: "Utility",
};

// ---------------------------------------------------------------------------
// Upgrade totals and tier
// ---------------------------------------------------------------------------

/** Sum of all upgrade levels across the 6 stats on a single ship. */
export function shipTotalUpgrades(ship: Pick<Ship,
  "hull_level" | "shield_level" | "cargo_level" |
  "engine_level" | "turret_level" | "utility_level"
>): number {
  return (
    ship.hull_level +
    ship.shield_level +
    ship.cargo_level +
    ship.engine_level +
    ship.turret_level +
    ship.utility_level
  );
}

/**
 * Derives ship tier from total upgrade count.
 *
 *   Tier 1:  0–3 upgrades
 *   Tier 2:  4–11
 *   Tier 3: 12–23
 *   Tier 4: 24–59
 *   Tier 5: 60
 */
export function shipTier(totalUpgrades: number): number {
  const thresholds = BALANCE.shipUpgrades.tierMinUpgrades; // [0,0,4,12,24,60]
  for (let t = 5; t >= 1; t--) {
    if (totalUpgrades >= thresholds[t]) return t;
  }
  return 1;
}

/** Remaining upgrade budget for one ship given research unlock state. */
export function remainingUpgrades(
  ship: Parameters<typeof shipTotalUpgrades>[0],
  unlockedIds: ReadonlySet<string>,
): number {
  return Math.max(0, maxTotalShipUpgrades(unlockedIds) - shipTotalUpgrades(ship));
}

// ---------------------------------------------------------------------------
// Effective derived stats
// ---------------------------------------------------------------------------

/**
 * Effective cargo capacity after applying cargo upgrade level.
 * cargo_cap = BASE + level × perLevel
 */
export function effectiveCargoCap(cargoLevel: number): number {
  return (
    BALANCE.shipUpgrades.baseCargoCapacity +
    cargoLevel * BALANCE.shipUpgrades.cargoCapPerLevel
  );
}

/**
 * Effective ship speed after applying engine upgrade level.
 * speed = BASE + level × perLevel   (rounded to 4 decimals to match DB type)
 */
export function effectiveSpeed(engineLevel: number): number {
  return parseFloat(
    (
      BALANCE.shipUpgrades.baseSpeedLyPerHr +
      engineLevel * BALANCE.shipUpgrades.speedPerLevel
    ).toFixed(4),
  );
}

// ---------------------------------------------------------------------------
// Upgrade cost
// ---------------------------------------------------------------------------

/**
 * Iron cost to upgrade `stat` to `targetLevel` (= currentLevel + 1).
 * Cost = ironCostPerLevel[stat] × targetLevel.
 */
export function upgradeIronCost(stat: ShipStatKey, targetLevel: number): number {
  return (BALANCE.shipUpgrades.ironCostPerLevel[stat] ?? 0) * targetLevel;
}

// ---------------------------------------------------------------------------
// Upgrade eligibility (per ship, per stat)
// ---------------------------------------------------------------------------

export interface StatUpgradeState {
  currentLevel: number;
  /** Cap from research for this stat (may be 0 if no research unlocked). */
  researchCap: number;
  /** Absolute hard cap (10). */
  absoluteCap: number;
  isAtStatCap: boolean;
  isAtTotalCap: boolean;
  /** True when neither stat cap nor total cap is blocking. */
  canUpgrade: boolean;
  /** Iron cost for the next level (currentLevel + 1). */
  ironCost: number;
}

/**
 * Computes upgrade eligibility for every stat on a single ship.
 * Does NOT check station resources (that requires a DB fetch).
 */
export function shipStatUpgradeStates(
  ship: Pick<Ship,
    "hull_level" | "shield_level" | "cargo_level" |
    "engine_level" | "turret_level" | "utility_level"
  >,
  unlockedIds: ReadonlySet<string>,
): Record<ShipStatKey, StatUpgradeState> {
  const total = shipTotalUpgrades(ship);
  const maxTotal = maxTotalShipUpgrades(unlockedIds);
  const isAtTotalCap = total >= maxTotal;

  const result = {} as Record<ShipStatKey, StatUpgradeState>;

  for (const stat of SHIP_STAT_KEYS) {
    const currentLevel = ship[`${stat}_level`] as number;
    const researchCap = maxStatLevel(stat, unlockedIds);
    const absoluteCap = 10;
    const effectiveCap = Math.min(researchCap, absoluteCap);
    const isAtStatCap = currentLevel >= effectiveCap;
    const canUpgrade = !isAtStatCap && !isAtTotalCap;
    const targetLevel = currentLevel + 1;
    const ironCost = upgradeIronCost(stat, targetLevel);

    result[stat] = {
      currentLevel,
      researchCap,
      absoluteCap,
      isAtStatCap,
      isAtTotalCap,
      canUpgrade,
      ironCost,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-ship summary (for dashboard rendering)
// ---------------------------------------------------------------------------

export interface ShipUpgradeSummary {
  tier: number;
  totalUpgrades: number;
  maxTotalUpgrades: number;
  stats: Record<ShipStatKey, StatUpgradeState>;
  effectiveCargoCap: number;
  effectiveSpeed: number;
}

export function buildShipUpgradeSummary(
  ship: Ship,
  unlockedIds: ReadonlySet<string>,
): ShipUpgradeSummary {
  const total = shipTotalUpgrades(ship);
  return {
    tier: shipTier(total),
    totalUpgrades: total,
    maxTotalUpgrades: maxTotalShipUpgrades(unlockedIds),
    stats: shipStatUpgradeStates(ship, unlockedIds),
    effectiveCargoCap: effectiveCargoCap(ship.cargo_level),
    effectiveSpeed: effectiveSpeed(ship.engine_level),
  };
}
