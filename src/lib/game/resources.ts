/**
 * Deterministic resource profile generation for bodies.
 *
 * Given a body's type and size (derived from its seed), produces:
 *   - basicResourceNodes: visible after a basic survey
 *   - deepResourceNodes: visible only after a Deep Survey Kit (premium)
 *
 * Rules from GAME_RULES.md §6:
 * - Common: iron, carbon, ice
 * - Refined: steel, fuel_cells, polymers (crafted — not directly mined)
 * - Rare: exotic_matter, crystalline_core, void_dust
 *
 * Rare nodes are deep-survey-only. The quantity cap is identical whether
 * found by basic or deep survey (anti-p2w invariant from §15).
 */

import type { BodyType, ResourceType } from "@/lib/types/enums";
import type { GeneratedResourceNode } from "@/lib/types/generated";
import type { BodySize } from "@/lib/types/generated";
import { randInt, weightedPick } from "./rng";

// ---------------------------------------------------------------------------
// Resource availability tables per body type
// ---------------------------------------------------------------------------

type ResourceWeight = { value: ResourceType; weight: number };

const COMMON_RESOURCES: Record<BodyType, ResourceWeight[]> = {
  rocky: [
    { value: "iron", weight: 6 },
    { value: "carbon", weight: 3 },
    { value: "ice", weight: 1 },
  ],
  habitable: [
    { value: "iron", weight: 4 },
    { value: "carbon", weight: 5 },
    { value: "ice", weight: 3 },
  ],
  gas_giant: [
    { value: "carbon", weight: 4 },
    { value: "ice", weight: 2 },
    { value: "iron", weight: 1 },
  ],
  ice_giant: [
    { value: "ice", weight: 8 },
    { value: "carbon", weight: 2 },
    { value: "iron", weight: 1 },
  ],
  asteroid_belt: [
    { value: "iron", weight: 7 },
    { value: "carbon", weight: 4 },
    { value: "ice", weight: 2 },
  ],
  barren: [
    { value: "iron", weight: 5 },
    { value: "carbon", weight: 2 },
    { value: "ice", weight: 1 },
  ],
  frozen: [
    { value: "ice", weight: 9 },
    { value: "carbon", weight: 2 },
    { value: "iron", weight: 1 },
  ],
};

const RARE_RESOURCES: Record<BodyType, ResourceWeight[]> = {
  rocky: [{ value: "crystalline_core", weight: 3 }, { value: "exotic_matter", weight: 1 }],
  habitable: [{ value: "crystalline_core", weight: 2 }, { value: "exotic_matter", weight: 2 }],
  gas_giant: [{ value: "exotic_matter", weight: 3 }, { value: "void_dust", weight: 2 }],
  ice_giant: [{ value: "void_dust", weight: 3 }, { value: "exotic_matter", weight: 1 }],
  asteroid_belt: [{ value: "crystalline_core", weight: 3 }, { value: "void_dust", weight: 2 }],
  barren: [{ value: "crystalline_core", weight: 2 }, { value: "void_dust", weight: 1 }],
  frozen: [{ value: "void_dust", weight: 3 }, { value: "crystalline_core", weight: 1 }],
};

// ---------------------------------------------------------------------------
// Quantity ranges per body size
// ---------------------------------------------------------------------------

const SIZE_QUANTITY: Record<BodySize, { min: number; max: number }> = {
  tiny:   { min: 100,  max: 400  },
  small:  { min: 300,  max: 1000 },
  medium: { min: 800,  max: 3000 },
  large:  { min: 2000, max: 8000 },
  huge:   { min: 5000, max: 20000 },
};

const RARE_QUANTITY: Record<BodySize, { min: number; max: number }> = {
  tiny:   { min: 10,  max: 50  },
  small:  { min: 30,  max: 150 },
  medium: { min: 80,  max: 400 },
  large:  { min: 200, max: 1000 },
  huge:   { min: 500, max: 2500 },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResourceProfileResult {
  basicResourceNodes: GeneratedResourceNode[];
  deepResourceNodes: GeneratedResourceNode[];
}

/**
 * Generate the full resource profile for a body.
 * The rng function must already be advanced to the right state
 * (i.e. called after body type/size have been drawn from the same rng).
 */
export function generateResourceProfile(
  rng: () => number,
  bodyType: BodyType,
  bodySize: BodySize,
): ResourceProfileResult {
  // Number of basic resource node types: 1–3 depending on size
  const basicNodeCount = bodyType === "gas_giant" ? 1 : randInt(rng, 1, 3);
  const qRange = SIZE_QUANTITY[bodySize];

  const basicResourceNodes: GeneratedResourceNode[] = [];
  const seenTypes = new Set<ResourceType>();

  for (let i = 0; i < basicNodeCount; i++) {
    const typeOptions = COMMON_RESOURCES[bodyType].filter(
      (o) => !seenTypes.has(o.value),
    );
    if (typeOptions.length === 0) break;
    const type = weightedPick(rng, typeOptions);
    seenTypes.add(type);
    basicResourceNodes.push({
      type,
      quantity: randInt(rng, qRange.min, qRange.max),
      isRare: false,
    });
  }

  // Rare nodes: 20% chance of 1 rare node, 5% of 2 rare nodes
  const deepResourceNodes: GeneratedResourceNode[] = [];
  const rareRoll = rng();
  const rareCount = rareRoll < 0.05 ? 2 : rareRoll < 0.20 ? 1 : 0;
  const rqRange = RARE_QUANTITY[bodySize];
  const rareOptions = RARE_RESOURCES[bodyType];
  const seenRare = new Set<ResourceType>();

  for (let i = 0; i < rareCount; i++) {
    const opts = rareOptions.filter((o) => !seenRare.has(o.value));
    if (opts.length === 0) break;
    const type = weightedPick(rng, opts);
    seenRare.add(type);
    deepResourceNodes.push({
      type,
      quantity: randInt(rng, rqRange.min, rqRange.max),
      isRare: true,
    });
  }

  return { basicResourceNodes, deepResourceNodes };
}
