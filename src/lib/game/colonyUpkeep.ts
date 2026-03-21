/**
 * Colony upkeep helpers — Phase 9 (reworked Phase 16).
 *
 * Pure functions only (no DB access). The resolution loop lives in the
 * dashboard page component, similar to growth and ship-automation resolution.
 *
 * Phase 16 upkeep model:
 *   ALL colonies consume food each period (population sustain resource).
 *   Harsh colonies (volcanic, toxic) also consume iron for dome maintenance.
 *
 * Period resolution:
 *   1. Compute food required: foodPerTierPerPeriod × tier × (1 − reductionFraction)
 *   2. For harsh colonies, compute iron required: ironPerTierPerPeriod × tier × (1 − reductionFraction)
 *   3. Consume what is available (partial consumption does NOT count as paid)
 *   4. Period is "paid" only if ALL required resources were fully supplied
 *   5. Health / tier degradation tracks consecutive missed periods as before
 *
 * Health status derived from upkeep_missed_periods (same thresholds as before):
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
  foodConsumed: number;
  ironConsumed: number;
  /** true = all required resources available and consumed. */
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
 * Food units required per period for all colonies (before reduction).
 */
export function upkeepFoodRequired(tier: number): number {
  return BALANCE.upkeep.foodPerTierPerPeriod * tier;
}

/**
 * Iron units required per period for harsh colonies (before reduction).
 * Returns 0 for non-harsh colonies.
 */
export function upkeepIronRequired(tier: number): number {
  return BALANCE.upkeep.ironPerTierPerPeriod * tier;
}

/**
 * Effective food cost after applying habitat_module / sustainability research reduction.
 */
export function effectiveUpkeepFoodRequired(
  tier: number,
  reductionFraction: number,
): number {
  const base = upkeepFoodRequired(tier);
  return Math.max(0, Math.ceil(base * (1 - reductionFraction)));
}

/**
 * Effective iron cost after reduction (harsh colonies only).
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
 * @param foodAvailable     food units available at station
 * @param ironAvailable     iron units available at station (harsh colonies only)
 * @param isHarshColony     true for volcanic/toxic — requires iron dome maintenance
 * @param periodEndAt       timestamp to use as the new last_upkeep_at
 * @param reductionFraction fraction of upkeep saved by structures/research (0–1)
 */
export function applyUpkeepPeriod(
  tier: number,
  missedPeriods: number,
  foodAvailable: number,
  ironAvailable: number,
  isHarshColony: boolean,
  periodEndAt: Date,
  reductionFraction = 0,
): UpkeepPeriodResult {
  const foodRequired = effectiveUpkeepFoodRequired(tier, reductionFraction);
  const ironRequired = isHarshColony ? effectiveUpkeepIronRequired(tier, reductionFraction) : 0;

  const foodPaid = foodAvailable >= foodRequired;
  const ironPaid = !isHarshColony || ironAvailable >= ironRequired;
  const paid = foodPaid && ironPaid;

  // Consume what is available (up to required), regardless of whether period is paid.
  const foodConsumed = Math.min(foodAvailable, foodRequired);
  const ironConsumed = isHarshColony ? Math.min(ironAvailable, ironRequired) : 0;

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

  return {
    foodConsumed,
    ironConsumed,
    paid,
    missedPeriods: newMissed,
    tierLost,
    newTier,
    newNextGrowthAt,
  };
}

/**
 * Resolve all overdue upkeep periods for a colony.
 *
 * @param colony               - Colony snapshot
 * @param periodsToResolve     - Number of periods to process
 * @param foodAvailableAtStart - Station food at start of resolution
 * @param ironAvailableAtStart - Station iron at start (for harsh colonies)
 * @param isHarshColony        - True for volcanic/toxic (dome maintenance required)
 * @param periodEndAt          - Timestamp for last_upkeep_at update
 * @param reductionFraction    - Fraction of upkeep saved (0–1, default 0)
 */
export function resolveColonyUpkeep(
  colony: Pick<Colony, "population_tier" | "upkeep_missed_periods" | "last_upkeep_at" | "next_growth_at">,
  periodsToResolve: number,
  foodAvailableAtStart: number,
  ironAvailableAtStart: number,
  isHarshColony: boolean,
  periodEndAt: Date,
  reductionFraction = 0,
): {
  foodConsumed: number;
  ironConsumed: number;
  newTier: number;
  newMissedPeriods: number;
  newLastUpkeepAt: string;
  newNextGrowthAt: string | null;
  tierLostCount: number;
} {
  let foodRemaining = foodAvailableAtStart;
  let ironRemaining = ironAvailableAtStart;
  let tier = colony.population_tier;
  let missed = colony.upkeep_missed_periods;
  let nextGrowth = colony.next_growth_at;
  let totalFoodConsumed = 0;
  let totalIronConsumed = 0;
  let tierLostCount = 0;

  for (let i = 0; i < periodsToResolve; i++) {
    const result = applyUpkeepPeriod(
      tier,
      missed,
      foodRemaining,
      ironRemaining,
      isHarshColony,
      periodEndAt,
      reductionFraction,
    );
    totalFoodConsumed += result.foodConsumed;
    totalIronConsumed += result.ironConsumed;
    foodRemaining -= result.foodConsumed;
    ironRemaining -= result.ironConsumed;
    missed = result.missedPeriods;
    if (result.tierLost) {
      tier = result.newTier;
      nextGrowth = result.newNextGrowthAt;
      tierLostCount++;
    }
  }

  return {
    foodConsumed: totalFoodConsumed,
    ironConsumed: totalIronConsumed,
    newTier: tier,
    newMissedPeriods: missed,
    newLastUpkeepAt: periodEndAt.toISOString(),
    newNextGrowthAt: nextGrowth ?? null,
    tierLostCount,
  };
}

// ---------------------------------------------------------------------------
// Upkeep description helpers (for UI)
// ---------------------------------------------------------------------------

/**
 * Return a human-readable description of what a colony needs each period.
 */
export function upkeepDescription(
  tier: number,
  isHarshColony: boolean,
  reductionFraction: number,
): string {
  const food = effectiveUpkeepFoodRequired(tier, reductionFraction);
  if (!isHarshColony) {
    return `${food} food / period`;
  }
  const iron = effectiveUpkeepIronRequired(tier, reductionFraction);
  return `${food} food + ${iron} iron / period (dome maintenance)`;
}
