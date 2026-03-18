/**
 * Colony tax calculation utilities.
 *
 * Taxes are calculated lazily from timestamps (GAME_RULES.md §7):
 * - No background cron job required.
 * - Server reads last_tax_collected_at and computes yield on demand.
 * - Accumulated yield is capped at 24 hours to prevent idle stacking.
 */

import { BALANCE } from "@/lib/config/balance";
import type { Colony } from "@/lib/types/game";

// ---------------------------------------------------------------------------
// Tax rate lookup
// ---------------------------------------------------------------------------

/**
 * Get the credits-per-hour tax rate for a given population tier.
 * Returns 0 for invalid tiers.
 */
export function taxRateForTier(populationTier: number): number {
  return BALANCE.colony.taxPerHourByTier[populationTier] ?? 0;
}

// ---------------------------------------------------------------------------
// Accumulated tax calculation
// ---------------------------------------------------------------------------

/**
 * Calculate how many credits have accumulated since last collection.
 *
 * @param lastCollectedAt - ISO timestamp of last tax collection
 * @param populationTier - Current colony tier (1–10)
 * @param now - Current server time (defaults to Date.now())
 * @returns Credits owed, capped at 24 hours of yield
 */
export function calculateAccumulatedTax(
  lastCollectedAt: string,
  populationTier: number,
  now: Date = new Date(),
): number {
  const lastMs = new Date(lastCollectedAt).getTime();
  const elapsedMs = Math.max(0, now.getTime() - lastMs);
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  const capHours = BALANCE.colony.taxAccumulationCapHours;
  const effectiveHours = Math.min(elapsedHours, capHours);

  const ratePerHour = taxRateForTier(populationTier);
  return Math.floor(effectiveHours * ratePerHour);
}

// ---------------------------------------------------------------------------
// Growth timing
// ---------------------------------------------------------------------------

/**
 * Calculate when a colony will reach the next population tier.
 * Returns null if the colony is at max tier.
 *
 * @param currentTier - Current population tier
 * @param from - Reference timestamp (when the tier was last reached)
 */
export function nextGrowthAt(
  currentTier: number,
  from: Date = new Date(),
): Date | null {
  const growthHours = BALANCE.colony.growthHoursByTier[currentTier];
  if (growthHours == null) return null; // max tier reached

  const durationMs = growthHours * 60 * 60 * 1000;
  return new Date(from.getTime() + durationMs);
}

// ---------------------------------------------------------------------------
// Growth resolution (lazy-resolve pattern)
// ---------------------------------------------------------------------------

export interface GrowthResolution {
  newTier: number;
  newNextGrowthAt: string | null;
  /** Number of tiers actually advanced. 0 if no growth was due. */
  tiersGained: number;
}

/**
 * Compute how many population tiers a colony has earned since its
 * last recorded next_growth_at. Pure function — no DB side effects.
 * The caller is responsible for persisting the resolved values.
 *
 * Each tier is timestamped from when the previous tier was reached,
 * preserving real growth timing regardless of when the page loads.
 *
 * @param currentTier     - Colony's current population_tier
 * @param colonyNextGrowthAt - ISO timestamp from colony.next_growth_at, or null
 * @param now             - Evaluation time (defaults to Date.now())
 */
export function resolveGrowth(
  currentTier: number,
  colonyNextGrowthAt: string | null,
  now: Date = new Date(),
): GrowthResolution {
  if (colonyNextGrowthAt == null) {
    return { newTier: currentTier, newNextGrowthAt: null, tiersGained: 0 };
  }

  // Max tier is the last index in the growthHoursByTier array.
  const maxTier = BALANCE.colony.growthHoursByTier.length - 1; // 10

  let tier = currentTier;
  let nextAt: Date | null = new Date(colonyNextGrowthAt);
  let tiersGained = 0;

  while (nextAt !== null && nextAt <= now && tier < maxTier) {
    // Record the timestamp when this tier was earned.
    const tierEarnedAt = nextAt;
    tier += 1;
    tiersGained += 1;
    // Next growth is relative to when THIS tier was earned.
    nextAt = nextGrowthAt(tier, tierEarnedAt);
  }

  return {
    newTier: tier,
    newNextGrowthAt: nextAt?.toISOString() ?? null,
    tiersGained,
  };
}

/**
 * Apply growth resolution to a Colony object (returns a new object).
 * Does NOT write to the database.
 */
export function applyGrowthResolution(
  colony: Colony,
  now: Date = new Date(),
): { colony: Colony; resolution: GrowthResolution } {
  const resolution = resolveGrowth(
    colony.population_tier,
    colony.next_growth_at,
    now,
  );
  if (resolution.tiersGained === 0) return { colony, resolution };
  return {
    colony: {
      ...colony,
      population_tier: resolution.newTier,
      next_growth_at: resolution.newNextGrowthAt,
    },
    resolution,
  };
}
