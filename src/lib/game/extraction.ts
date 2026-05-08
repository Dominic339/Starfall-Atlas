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
 *   (applied per resource node revealed by survey).
 * - Yield is capped at accumulationCapHours to prevent idle overflow.
 * - Basic nodes are always extracted (requires any extractor or none).
 * - Rare nodes (is_rare = true) require an Extractor structure at tier 2+.
 *   Rare node rate = basic rate × rareExtractionRateFraction (25% by default).
 *
 * Resource flow in this phase:
 *   colony extraction → station inventory (direct, no ship transport yet)
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
 * Calculate how many units of each resource have accumulated since last extraction.
 *
 * Basic nodes are always included. Rare nodes (is_rare = true) are included only
 * when extractorTier >= 2, at a reduced rate (rareExtractionRateFraction × basic rate).
 *
 * @param resourceNodes        - Resource nodes from the body's survey result
 * @param populationTier       - Current colony tier (1–10)
 * @param lastExtractAt        - ISO timestamp of last extraction (or colony founding)
 * @param now                  - Current server time (defaults to Date.now())
 * @param extractionMultiplier - Bonus multiplier from structures/research (default 1.0).
 *                               Applied after the base rate. Health multiplier is applied
 *                               separately by the caller.
 * @param balance              - Balance config override.
 * @param extractorTier        - Active extractor tier (0 = no extractor). Rare nodes
 *                               require tier ≥ 2.
 * @returns Array of { resource_type, quantity } for each node with >0 yield.
 */
export function calculateAccumulatedExtraction(
  resourceNodes: ResourceNodeRecord[],
  populationTier: number,
  lastExtractAt: string,
  now: Date = new Date(),
  extractionMultiplier = 1.0,
  balance: BalanceConfig = BALANCE,
  extractorTier = 0,
): ExtractionAmount[] {
  const lastMs = new Date(lastExtractAt).getTime();
  const elapsedMs = Math.max(0, now.getTime() - lastMs);
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  const capHours = balance.extraction.accumulationCapHours;
  const effectiveHours = Math.min(elapsedHours, capHours);

  const baseRatePerHr = extractionRatePerNode(populationTier, balance);
  const rareRatePerHr = baseRatePerHr * balance.extraction.rareExtractionRateFraction;
  const canExtractRare = extractorTier >= 2;

  // Accumulate yields per resource type (multiple nodes of the same type sum together).
  const totals = new Map<string, number>();
  for (const node of resourceNodes) {
    if (node.is_rare && !canExtractRare) continue;
    const rate = node.is_rare ? rareRatePerHr : baseRatePerHr;
    const qty = Math.floor(effectiveHours * rate * extractionMultiplier);
    if (qty > 0) {
      totals.set(node.type, (totals.get(node.type) ?? 0) + qty);
    }
  }

  return Array.from(totals.entries()).map(([resource_type, quantity]) => ({
    resource_type,
    quantity,
  }));
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
