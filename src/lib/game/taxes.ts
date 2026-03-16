/**
 * Colony tax calculation utilities.
 *
 * Taxes are calculated lazily from timestamps (GAME_RULES.md §7):
 * - No background cron job required.
 * - Server reads last_tax_collected_at and computes yield on demand.
 * - Accumulated yield is capped at 24 hours to prevent idle stacking.
 */

import { BALANCE } from "@/lib/config/balance";

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
