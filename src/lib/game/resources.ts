/**
 * Deterministic resource profile generation for bodies.
 *
 * Phase 16 rewrite: planet types now have distinct resource identities that
 * map to the extended resource set introduced in Phase 15.
 *
 * Planet → primary resources:
 *   lush       → biomass, water          (food chain input)
 *   ocean      → biomass, water (high)   (food chain input)
 *   desert     → silica, iron            (glass + industrial)
 *   ice_planet → water, sulfur           (food + chemicals)
 *   volcanic   → sulfur, iron, rare_crystal (industrial + rare)
 *   toxic      → sulfur, rare_crystal    (chemicals + rare)
 *   rocky      → iron, carbon            (construction backbone)
 *   habitable  → biomass, water, carbon  (legacy — same as lush)
 *   barren     → iron, silica            (dry industrial)
 *   frozen     → water, carbon           (legacy)
 *
 * Rules:
 * - Basic nodes: visible after a standard survey, fully extractable
 * - Deep nodes: visible only after a Deep Survey Kit (premium), is_rare = true
 * - Rare node types (exotic_matter, crystalline_core, void_dust) are deep-only
 * - rare_crystal is NOT a deep-only type; it can appear in basic nodes for
 *   volcanic / toxic planets (it is the semi-rare mineral of those worlds)
 */

import type { BodyType, ResourceType } from "@/lib/types/enums";
import type { GeneratedResourceNode } from "@/lib/types/generated";
import type { BodySize } from "@/lib/types/generated";
import { randInt, weightedPick } from "./rng";

// ---------------------------------------------------------------------------
// Resource availability tables per body type
// ---------------------------------------------------------------------------

type ResourceWeight = { value: ResourceType; weight: number };

// Phase 28 (Resource Safety): All planet types include iron with at least
// a small weight. This ensures every colony site produces some iron,
// which is the primary construction resource for upgrades and founding.
//
// Phase 31: Colonizable types are also post-processed in generateResourceProfile
// to guarantee at least one iron node is present (weight alone is probabilistic).
const COLONIZABLE_TYPES = new Set<BodyType>([
  "lush", "ocean", "desert", "ice_planet", "volcanic", "toxic", "habitable",
]);

const COMMON_RESOURCES: Record<BodyType, ResourceWeight[]> = {
  // ── Phase 16 named planet types ──────────────────────────────────────────
  lush: [
    { value: "biomass", weight: 5 },
    { value: "water",   weight: 4 },
    { value: "iron",    weight: 1 }, // trace iron deposits
  ],
  ocean: [
    { value: "water",   weight: 7 },
    { value: "biomass", weight: 3 },
    { value: "iron",    weight: 1 }, // seafloor iron deposits
  ],
  desert: [
    { value: "silica",  weight: 7 },
    { value: "iron",    weight: 3 }, // iron-rich desert regolith
    { value: "carbon",  weight: 1 },
  ],
  ice_planet: [
    { value: "water",   weight: 6 },
    { value: "sulfur",  weight: 3 },
    { value: "iron",    weight: 1 }, // subsurface iron
  ],
  volcanic: [
    { value: "sulfur",       weight: 5 },
    { value: "iron",         weight: 4 }, // volcanic iron-rich lava fields
    { value: "rare_crystal", weight: 2 },
  ],
  toxic: [
    { value: "sulfur",       weight: 5 },
    { value: "rare_crystal", weight: 3 },
    { value: "iron",         weight: 2 }, // corroded iron formations
    { value: "carbon",       weight: 1 },
  ],

  // ── Legacy types (pre-Phase 16; updated for Phase 15 resource set) ────────
  rocky: [
    { value: "iron",   weight: 6 },
    { value: "carbon", weight: 3 },
  ],
  habitable: [
    { value: "biomass", weight: 4 },
    { value: "water",   weight: 4 },
    { value: "iron",    weight: 2 }, // iron-rich soil
    { value: "carbon",  weight: 1 },
  ],
  gas_giant: [
    { value: "carbon", weight: 5 },
    { value: "sulfur", weight: 2 },
    { value: "iron",   weight: 1 }, // metallic core ejecta
  ],
  ice_giant: [
    { value: "water",  weight: 6 },
    { value: "carbon", weight: 2 },
    { value: "iron",   weight: 1 }, // deep metallic deposits
  ],
  asteroid_belt: [
    { value: "iron",   weight: 7 },
    { value: "carbon", weight: 4 },
  ],
  barren: [
    { value: "iron",   weight: 5 },
    { value: "silica", weight: 2 },
  ],
  frozen: [
    { value: "water",  weight: 7 },
    { value: "iron",   weight: 2 }, // iron-rich permafrost
    { value: "carbon", weight: 2 },
  ],
};

// Deep nodes use only the three truly rare types (never gatherable via basic survey).
const RARE_RESOURCES: Record<BodyType, ResourceWeight[]> = {
  // Phase 16 types
  lush:         [{ value: "exotic_matter",    weight: 2 }, { value: "crystalline_core", weight: 1 }],
  ocean:        [{ value: "exotic_matter",    weight: 3 }, { value: "void_dust",        weight: 1 }],
  desert:       [{ value: "crystalline_core", weight: 3 }, { value: "void_dust",        weight: 1 }],
  ice_planet:   [{ value: "void_dust",        weight: 3 }, { value: "exotic_matter",    weight: 1 }],
  volcanic:     [{ value: "crystalline_core", weight: 2 }, { value: "exotic_matter",    weight: 2 }],
  toxic:        [{ value: "void_dust",        weight: 2 }, { value: "exotic_matter",    weight: 2 }],
  // Legacy types
  rocky:        [{ value: "crystalline_core", weight: 3 }, { value: "exotic_matter",    weight: 1 }],
  habitable:    [{ value: "crystalline_core", weight: 2 }, { value: "exotic_matter",    weight: 2 }],
  gas_giant:    [{ value: "exotic_matter",    weight: 3 }, { value: "void_dust",        weight: 2 }],
  ice_giant:    [{ value: "void_dust",        weight: 3 }, { value: "exotic_matter",    weight: 1 }],
  asteroid_belt:[{ value: "crystalline_core", weight: 3 }, { value: "void_dust",        weight: 2 }],
  barren:       [{ value: "crystalline_core", weight: 2 }, { value: "void_dust",        weight: 1 }],
  frozen:       [{ value: "void_dust",        weight: 3 }, { value: "crystalline_core", weight: 1 }],
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

  // Phase 31: guarantee at least one iron node for colonizable worlds.
  if (COLONIZABLE_TYPES.has(bodyType) && !seenTypes.has("iron")) {
    basicResourceNodes.push({
      type: "iron",
      quantity: randInt(rng, qRange.min, qRange.max),
      isRare: false,
    });
    seenTypes.add("iron");
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
