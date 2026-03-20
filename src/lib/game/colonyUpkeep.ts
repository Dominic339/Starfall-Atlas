/**
 * Colony upkeep helpers — Phase 9.
 *
 * Pure functions only (no DB access). The resolution loop lives in the
 * dashboard page component, similar to growth and ship-automation resolution.
 *
 * Upkeep cycle (every BALANCE.upkeep.periodHours hours):
 *   - Draw `ironPerTierPerPeriod × population_tier` iron from station inventory.
 *   - If iron available: upkeep_missed_periods decrements by 1 (min 0).
 *   - If iron unavailable: upkeep_missed_periods increments by 1.
 *   - Every `tierLossMissedPeriods` consecutive misses: tier − 1, counter resets.
 *
 * Health status derived from upkeep_missed_periods:
 *   0           → "well_supplied"
 *   1–2         → "struggling"
 *   3+          → "neglected"
 */

import { BALANCE } from "@/lib/config/balance";
import { nextGrowthAt } from "@/lib/game/taxes";
import type { Colony } from "@/lib/types/game";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColonyHealthStatus = "well_supplied" | "struggling" | "neglected";

export interface UpkeepPeriodResult {
  ironConsumed: number;
  /** true = iron was available and consumed; false = missed (no iron). */
  paid: boolean;
  /** New upkeep_missed_periods after this period. */
  missedPeriods: number;
  /** True if a tier loss occurred during this period. */
  tierLost: boolean;
  /** New tier after any degradation (same as input if no tier loss). */
  newTier: number;
  /** New next_growth_at after any tier change. */
  newNextGrowthAt: string | null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * How many iron units the colony needs for one upkeep period (base, no reduction).
 */
export function upkeepIronRequired(tier: number): number {
  return BALANCE.upkeep.ironPerTierPerPeriod * tier;
}

/**
 * Effective iron cost after applying habitat_module / sustainability research reduction.
 *
 * @param tier             - Colony population tier
 * @param reductionFraction - Fraction of upkeep saved (0.0–1.0). 0 = full cost.
 */
export function effectiveUpkeepIronRequired(
  tier: number,
  reductionFraction: number,
): number {
  const base = upkeepIronRequired(tier);
  return Math.max(0, Math.ceil(base * (1 - reductionFraction)));
}

/**
 * Health status derived from missed periods count.
 */
export function colonyHealthStatus(missedPeriods: number): ColonyHealthStatus {
  if (missedPeriods >= BALANCE.upkeep.neglectedThreshold) return "neglected";
  if (missedPeriods >= BALANCE.upkeep.strugglingThreshold) return "struggling";
  return "well_supplied";
}

/**
 * Extraction yield multiplier based on health.
 * struggling = 50% of normal, neglected = 25%.
 */
export function extractionMultiplier(missedPeriods: number): number {
  if (missedPeriods >= BALANCE.upkeep.neglectedThreshold) return 0.25;
  if (missedPeriods >= BALANCE.upkeep.strugglingThreshold) return 0.5;
  return 1.0;
}

/**
 * Tax yield multiplier based on health.
 * struggling = 75%, neglected = 50%.
 */
export function taxMultiplier(missedPeriods: number): number {
  if (missedPeriods >= BALANCE.upkeep.neglectedThreshold) return 0.5;
  if (missedPeriods >= BALANCE.upkeep.strugglingThreshold) return 0.75;
  return 1.0;
}

/**
 * Growth is blocked when the colony is struggling or neglected (missed ≥ 1).
 */
export function isGrowthBlocked(missedPeriods: number): boolean {
  return missedPeriods >= BALANCE.upkeep.strugglingThreshold;
}

/**
 * How many full upkeep periods have elapsed since last_upkeep_at,
 * capped at BALANCE.upkeep.maxCatchupPeriods.
 */
export function upkeepPeriodsToResolve(
  lastUpkeepAt: string | null,
  now: Date,
): number {
  if (!lastUpkeepAt) return 0;
  const last = new Date(lastUpkeepAt);
  const elapsedMs = now.getTime() - last.getTime();
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  const periods = Math.floor(elapsedHours / BALANCE.upkeep.periodHours);
  return Math.min(periods, BALANCE.upkeep.maxCatchupPeriods);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Apply one upkeep period to a colony.
 *
 * @param tier              current population_tier
 * @param missedPeriods     current upkeep_missed_periods
 * @param ironAvailable     iron units in station inventory (may be partial/0)
 * @param periodEndAt       timestamp to use as the new last_upkeep_at
 * @param reductionFraction fraction of upkeep saved by structures/research (0–1, default 0)
 * @returns UpkeepPeriodResult with updated fields and iron consumed
 */
export function applyUpkeepPeriod(
  tier: number,
  missedPeriods: number,
  ironAvailable: number,
  periodEndAt: Date,
  reductionFraction = 0,
): UpkeepPeriodResult {
  const required = effectiveUpkeepIronRequired(tier, reductionFraction);
  const paid = ironAvailable >= required;
  const ironConsumed = paid ? required : 0;

  let newMissed: number;
  let newTier = tier;
  let tierLost = false;
  let newNextGrowthAt: string | null = null;

  if (paid) {
    // Recovery: reduce missed count by 1 (floor 0).
    newMissed = Math.max(0, missedPeriods - 1);
  } else {
    newMissed = missedPeriods + 1;
    // Check for tier degradation every tierLossMissedPeriods consecutive misses.
    if (newMissed % BALANCE.upkeep.tierLossMissedPeriods === 0 && tier > 1) {
      newTier = tier - 1;
      tierLost = true;
      newMissed = 0; // Reset counter after tier loss.
      // Recalculate growth timer for the new (lower) tier.
      const growth = nextGrowthAt(newTier, periodEndAt);
      newNextGrowthAt = growth ? growth.toISOString() : null;
    }
  }

  return { ironConsumed, paid, missedPeriods: newMissed, tierLost, newTier, newNextGrowthAt };
}

/**
 * Resolve all overdue upkeep periods for a colony, given the current iron
 * balance available at the station. Processes periods sequentially —
 * iron drawn from each period reduces what is available for the next.
 *
 * Returns the DB fields to update and the total iron consumed.
 *
 * @param colony               - Colony snapshot
 * @param periodsToResolve     - Number of periods to process
 * @param ironAvailableAtStart - Station iron at start
 * @param periodEndAt          - Timestamp for last_upkeep_at update
 * @param reductionFraction    - Fraction of upkeep saved (0–1, default 0)
 */
export function resolveColonyUpkeep(
  colony: Pick<Colony, "population_tier" | "upkeep_missed_periods" | "last_upkeep_at" | "next_growth_at">,
  periodsToResolve: number,
  ironAvailableAtStart: number,
  periodEndAt: Date,
  reductionFraction = 0,
): {
  ironConsumed: number;
  newTier: number;
  newMissedPeriods: number;
  newLastUpkeepAt: string;
  newNextGrowthAt: string | null;
  tierLostCount: number;
} {
  let ironRemaining = ironAvailableAtStart;
  let tier = colony.population_tier;
  let missed = colony.upkeep_missed_periods;
  let nextGrowth = colony.next_growth_at;
  let totalIronConsumed = 0;
  let tierLostCount = 0;

  for (let i = 0; i < periodsToResolve; i++) {
    const result = applyUpkeepPeriod(tier, missed, ironRemaining, periodEndAt, reductionFraction);
    totalIronConsumed += result.ironConsumed;
    ironRemaining -= result.ironConsumed;
    missed = result.missedPeriods;
    if (result.tierLost) {
      tier = result.newTier;
      nextGrowth = result.newNextGrowthAt;
      tierLostCount++;
    }
  }

  return {
    ironConsumed: totalIronConsumed,
    newTier: tier,
    newMissedPeriods: missed,
    newLastUpkeepAt: periodEndAt.toISOString(),
    newNextGrowthAt: nextGrowth ?? null,
    tierLostCount,
  };
}
