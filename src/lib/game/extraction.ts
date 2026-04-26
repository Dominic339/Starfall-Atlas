/**
 * Colony resource extraction utilities.
 *
 * Extraction is the mechanism by which active colonies convert surveyed
 * resource nodes into physical resources accumulated in the player's
 * core station inventory (GAME_RULES.md §7.1).
 *
 * Like taxes, extraction is calculated lazily from timestamps:
 * - Colony.last_extract_at is the reference timestamp.
 * - Rate = BALANCE.extraction.baseUnitsPerHrPerTier × population_tier
 *   (applied per basic resource node revealed by survey).
 * - Yield is capped at accumulationCapHours to prevent idle overflow.
 * - Only basic (non-rare) resource nodes are extracted in alpha.
 *   Rare node extraction requires Deep Survey Kit + Extractor structure (future).
 *
 * Resource flow in this phase:
 *   colony extraction → station inventory (direct, no ship transport yet)
 *
 * In later phases ships will haul resources colony → station, making
 * the transport chain explicit. The inventory model is already
 * station-aware so no breaking changes are required.
 */

import { BALANCE } from "@/lib/config/balance";
import type { BalanceConfig } from "@/lib/config/balanceOverrides";
import type { ResourceNodeRecord } from "@/lib/types/game";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractionAmount {
  resource_type: string;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Rate helper
// ---------------------------------------------------------------------------

/**
 * Units extracted per hour per resource node at a given colony tier.
 */
export function extractionRatePerNode(populationTier: number, balance: BalanceConfig = BALANCE): number {
  return balance.extraction.baseUnitsPerHrPerTier * populationTier;
}

// ---------------------------------------------------------------------------
// Accumulated extraction calculation
// ---------------------------------------------------------------------------

/**
 * Calculate how many units of each basic resource have accumulated
 * since last extraction.
 *
 * @param resourceNodes       - Resource nodes from the body's survey result
 * @param populationTier      - Current colony tier (1–10)
 * @param lastExtractAt       - ISO timestamp of last extraction (or colony founding)
 * @param now                 - Current server time (defaults to Date.now())
 * @param extractionMultiplier - Bonus multiplier from structures/research (default 1.0).
 *                               Applied after the base rate. Health multiplier is applied
 *                               separately by the caller.
 * @returns Array of { resource_type, quantity } for each node with >0 yield.
 *          Returns [] if nothing has accrued yet.
 */
export function calculateAccumulatedExtraction(
  resourceNodes: ResourceNodeRecord[],
  populationTier: number,
  lastExtractAt: string,
  now: Date = new Date(),
  extractionMultiplier = 1.0,
  balance: BalanceConfig = BALANCE,
): ExtractionAmount[] {
  const lastMs = new Date(lastExtractAt).getTime();
  const elapsedMs = Math.max(0, now.getTime() - lastMs);
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  const capHours = balance.extraction.accumulationCapHours;
  const effectiveHours = Math.min(elapsedHours, capHours);

  const ratePerHr = extractionRatePerNode(populationTier, balance);

  return resourceNodes
    .filter((node) => !node.is_rare) // rare nodes require Extractor structure (future)
    .map((node) => ({
      resource_type: node.type,
      quantity: Math.floor(effectiveHours * ratePerHr * extractionMultiplier),
    }))
    .filter((item) => item.quantity > 0);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Format an extraction amount array as a human-readable summary string.
 * Example: "5 iron, 3 carbon"
 */
export function formatExtractionSummary(amounts: ExtractionAmount[]): string {
  if (amounts.length === 0) return "";
  return amounts.map((a) => `${a.quantity} ${a.resource_type}`).join(", ");
}
