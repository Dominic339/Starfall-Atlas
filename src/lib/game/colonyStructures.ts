/**
 * Colony structure helpers — Phase 14.
 *
 * Pure functions for computing gameplay effects from colony structures
 * and wired colony research. No DB access.
 *
 * Three buildable structure types in alpha:
 *   extractor      — boosts extraction yield (multiplier)
 *   warehouse      — increases colony storage cap
 *   habitat_module — reduces iron upkeep requirement
 *
 * Research wiring:
 *   extraction_1..5     → bonus added to extraction multiplier
 *   sustainability_1..5 → reduces upkeep fraction required
 *   storage_1..5        → adds to effective storage cap
 */

import { BALANCE } from "@/lib/config/balance";
import type { Structure } from "@/lib/types/game";
import type { StructureType } from "@/lib/types/enums";

// ---------------------------------------------------------------------------
// Structure lookup
// ---------------------------------------------------------------------------

/**
 * Returns the active tier for a structure type on a colony, or 0 if not built.
 */
export function getStructureTier(structures: Structure[], type: StructureType): number {
  return structures.find((s) => s.type === type && s.is_active)?.tier ?? 0;
}

// ---------------------------------------------------------------------------
// Research level helpers
// ---------------------------------------------------------------------------

/**
 * Returns the highest level unlocked for a sequential research series
 * (e.g. extraction_1..5). Since research is purchased sequentially,
 * the level equals the count of contiguous unlocked entries.
 */
export function researchLevel(
  unlockedIds: Set<string>,
  baseId: string,
  maxLevels = 5,
): number {
  let level = 0;
  for (let i = 1; i <= maxLevels; i++) {
    if (unlockedIds.has(`${baseId}_${i}`)) level = i;
    else break;
  }
  return level;
}

// ---------------------------------------------------------------------------
// Effect computations
// ---------------------------------------------------------------------------

/**
 * Total extraction yield multiplier from an active extractor structure
 * and unlocked extraction research.
 *
 * Base = 1.0 (no extractor, no research).
 * Each extractor tier adds +0.25 (tier 3 = 1.75×).
 * Each extraction research level adds +0.10 (5 levels = +0.50).
 */
export function extractionBonusMultiplier(
  extractorTier: number,
  extractionResearchLevel: number,
): number {
  const structureBonus =
    extractorTier * BALANCE.structures.extractor.extractionBonusPerTier;
  const researchBonus =
    extractionResearchLevel *
    BALANCE.structures.researchEffects.extractionBonusPerLevel;
  return 1.0 + structureBonus + researchBonus;
}

/**
 * Fraction of upkeep iron saved from a habitat_module and sustainability research.
 * Capped at 1.0 (100% reduction — free upkeep).
 *
 * Each habitat_module tier saves 20% (tier 3 = 60% saved).
 * Each sustainability research level saves 10% (5 levels = 50% saved).
 */
export function upkeepReductionFraction(
  habitatModuleTier: number,
  sustainabilityResearchLevel: number,
): number {
  const structureReduction =
    habitatModuleTier * BALANCE.structures.habitat_module.upkeepReductionPerTier;
  const researchReduction =
    sustainabilityResearchLevel *
    BALANCE.structures.researchEffects.sustainabilityBonusPerLevel;
  return Math.min(1.0, structureReduction + researchReduction);
}

/**
 * Effective colony storage cap after warehouse bonus and storage research.
 *
 * Each warehouse tier adds 500 units.
 * Each storage research level adds 200 units.
 */
export function effectiveStorageCap(
  baseCap: number,
  warehouseTier: number,
  storageResearchLevel: number,
): number {
  const warehouseBonus =
    warehouseTier * BALANCE.structures.warehouse.storageCapPerTier;
  const researchBonus =
    storageResearchLevel * BALANCE.structures.researchEffects.storageCapPerLevel;
  return baseCap + warehouseBonus + researchBonus;
}

/**
 * Resource cost to build or upgrade a structure to the given target tier.
 * Throws if the tier is out of range.
 */
export function structureBuildCost(targetTier: number): { iron: number; carbon: number } {
  const cost = BALANCE.structures.buildCostByTier[targetTier];
  if (!cost || targetTier < 1 || targetTier > BALANCE.structures.maxTier) {
    throw new Error(`Invalid structure tier: ${targetTier}`);
  }
  return cost;
}
