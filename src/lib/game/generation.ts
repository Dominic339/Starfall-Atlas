/**
 * Deterministic system and body generation.
 *
 * IMPORTANT INVARIANTS:
 * 1. The same system_id always produces the same output.
 * 2. No database reads or writes occur in any function in this file.
 * 3. When the real star catalog is available, plug it in via CatalogEntry
 *    overrides — the generation logic stays identical.
 *
 * Catalog integration point: pass a CatalogEntry to generateSystem()
 * to override the generated name, spectral class, and position.
 */

import type { SpectralClass, BodyType } from "@/lib/types/enums";
import type {
  GeneratedSystem,
  GeneratedBody,
  BodySize,
  CatalogEntry,
} from "@/lib/types/generated";
import type { SystemId, BodyId } from "@/lib/types/game";
import { seededRng, randInt, weightedPick } from "./rng";
import { generateResourceProfile } from "./resources";
import { computeHabitability } from "./habitability";

// ---------------------------------------------------------------------------
// Spectral class distribution (realistic weighted toward K/M dwarfs)
// ---------------------------------------------------------------------------

const SPECTRAL_WEIGHTS: Array<{ value: SpectralClass; weight: number }> = [
  { value: "M", weight: 76 },
  { value: "K", weight: 12 },
  { value: "G", weight:  7 },
  { value: "F", weight:  3 },
  { value: "A", weight:  1 },
  { value: "B", weight:  0.1 },
  { value: "O", weight:  0.01 },
];

// ---------------------------------------------------------------------------
// Body type distribution per spectral class
// ---------------------------------------------------------------------------

type BodyTypeWeight = { value: BodyType; weight: number };

function bodyTypeWeights(spectralClass: SpectralClass): BodyTypeWeight[] {
  switch (spectralClass) {
    case "G":
    case "K":
      // Sol-like stars: rich diversity including lush, ocean, volcanic worlds.
      return [
        { value: "rocky",         weight: 22 },
        { value: "lush",          weight: 14 }, // Phase 16
        { value: "habitable",     weight: 6  }, // legacy
        { value: "ocean",         weight: 6  }, // Phase 16
        { value: "gas_giant",     weight: 16 },
        { value: "ice_giant",     weight: 8  },
        { value: "asteroid_belt", weight: 10 },
        { value: "desert",        weight: 6  }, // Phase 16
        { value: "barren",        weight: 4  },
        { value: "frozen",        weight: 3  },
        { value: "ice_planet",    weight: 3  }, // Phase 16
        { value: "volcanic",      weight: 1  }, // Phase 16 — rare
        { value: "toxic",         weight: 1  }, // Phase 16 — rare
      ];
    case "F":
      // Slightly hotter stars: fewer lush, more desert and barren.
      return [
        { value: "rocky",         weight: 28 },
        { value: "lush",          weight: 8  }, // Phase 16
        { value: "habitable",     weight: 4  }, // legacy
        { value: "desert",        weight: 8  }, // Phase 16
        { value: "gas_giant",     weight: 22 },
        { value: "ice_giant",     weight: 10 },
        { value: "asteroid_belt", weight: 10 },
        { value: "barren",        weight: 5  },
        { value: "frozen",        weight: 3  },
        { value: "ice_planet",    weight: 1  }, // Phase 16
        { value: "volcanic",      weight: 1  }, // Phase 16
      ];
    case "M":
      // Red dwarfs: mostly rocky, barren, frozen; occasional lush in close orbits.
      return [
        { value: "rocky",         weight: 32 },
        { value: "barren",        weight: 18 },
        { value: "frozen",        weight: 12 },
        { value: "lush",          weight: 6  }, // Phase 16
        { value: "habitable",     weight: 4  }, // legacy
        { value: "desert",        weight: 6  }, // Phase 16
        { value: "asteroid_belt", weight: 10 },
        { value: "gas_giant",     weight: 5  },
        { value: "ice_planet",    weight: 3  }, // Phase 16
        { value: "ice_giant",     weight: 2  },
        { value: "volcanic",      weight: 1  }, // Phase 16
        { value: "toxic",         weight: 1  }, // Phase 16
      ];
    case "A":
    case "B":
    case "O":
      // Hot, harsh stars: rocky and barren dominant; no lush worlds.
      return [
        { value: "rocky",         weight: 33 },
        { value: "barren",        weight: 28 },
        { value: "desert",        weight: 8  }, // Phase 16
        { value: "volcanic",      weight: 4  }, // Phase 16 — more common near hot stars
        { value: "toxic",         weight: 3  }, // Phase 16
        { value: "gas_giant",     weight: 14 },
        { value: "ice_giant",     weight: 6  },
        { value: "asteroid_belt", weight: 4  },
        { value: "frozen",        weight: 0  },
        { value: "habitable",     weight: 0  },
      ];
  }
}

// ---------------------------------------------------------------------------
// Body size distribution
// ---------------------------------------------------------------------------

const SIZE_WEIGHTS: Array<{ value: BodySize; weight: number }> = [
  { value: "tiny",   weight: 15 },
  { value: "small",  weight: 30 },
  { value: "medium", weight: 30 },
  { value: "large",  weight: 20 },
  { value: "huge",   weight: 5  },
];

// ---------------------------------------------------------------------------
// Body count per spectral class
// ---------------------------------------------------------------------------

function bodyCountRange(spectralClass: SpectralClass): { min: number; max: number } {
  switch (spectralClass) {
    case "O":
    case "B": return { min: 1, max: 4  };
    case "A": return { min: 2, max: 6  };
    case "F":
    case "G": return { min: 3, max: 10 };
    case "K": return { min: 2, max: 8  };
    case "M": return { min: 1, max: 6  };
  }
}

// ---------------------------------------------------------------------------
// Name generation (placeholder until real catalog data)
// ---------------------------------------------------------------------------

const NAME_PREFIXES = [
  "Astra", "Vel", "Cen", "Lyra", "Sag", "Vega", "Nor", "Pyx",
  "Col", "Ara", "Pav", "Tuc", "Car", "Pup", "Ant", "Lup",
];
const NAME_SUFFIXES = [
  "ia", "is", "us", "ae", "on", "ara", "ix", "or", "el", "ax",
];

function generateSystemName(rng: () => number): string {
  const prefix = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
  const suffix = NAME_SUFFIXES[Math.floor(rng() * NAME_SUFFIXES.length)];
  return prefix + suffix;
}

// ---------------------------------------------------------------------------
// Public: generate a full system
// ---------------------------------------------------------------------------

/**
 * Generate a complete star system from a stable system_id.
 *
 * @param systemId - The stable catalog ID string (e.g. "HYG:12345" or "sol").
 * @param catalogEntry - Optional real catalog data to override generated values.
 *                       When plugging in the HYG catalog, pass the entry here.
 */
export function generateSystem(
  systemId: string,
  catalogEntry?: CatalogEntry,
): GeneratedSystem {
  const rng = seededRng(systemId);

  // Spectral class: use catalog if available, otherwise generate
  const spectralClass: SpectralClass = catalogEntry?.spectralClass
    ?? weightedPick(rng, SPECTRAL_WEIGHTS);

  // Name: use catalog proper name if available
  const name = catalogEntry?.properName ?? generateSystemName(rng);

  // Position: use catalog if available, otherwise place near origin at a
  // deterministic distance (placeholder until real catalog is loaded)
  const positionLy = catalogEntry
    ? { x: catalogEntry.x, y: catalogEntry.y, z: catalogEntry.z }
    : {
        x: (rng() - 0.5) * 200,
        y: (rng() - 0.5) * 200,
        z: (rng() - 0.5) * 50,
      };

  const distanceFromSolLy = catalogEntry?.distance
    ?? Math.sqrt(
        positionLy.x ** 2 + positionLy.y ** 2 + positionLy.z ** 2,
      );

  // Body count
  const { min, max } = bodyCountRange(spectralClass);
  const bodyCount = randInt(rng, min, max);

  // Generate each body
  const bodies: GeneratedBody[] = [];
  for (let i = 0; i < bodyCount; i++) {
    bodies.push(generateBody(`${systemId}:${i}`, i, spectralClass, rng));
  }

  // Anchor body: prefer habitable or rocky bodies with best habitability
  const anchorBodyIndex = pickAnchorBody(bodies);

  return {
    id: systemId as SystemId,
    seed: 0, // seed integer not exposed; internal to rng
    name,
    spectralClass,
    positionLy,
    distanceFromSolLy,
    bodyCount,
    bodies,
    anchorBodyIndex,
  };
}

// ---------------------------------------------------------------------------
// Public: generate a single body
// ---------------------------------------------------------------------------

/**
 * Generate a single body from its stable body_id.
 * If spectralClass is provided, body type distribution is biased accordingly.
 * The caller-supplied rng is used so that body generation order stays consistent
 * within a system.
 */
export function generateBody(
  bodyId: string,
  index: number,
  spectralClass: SpectralClass,
  rng: () => number,
): GeneratedBody {
  const type = weightedPick(rng, bodyTypeWeights(spectralClass));
  const size = weightedPick(rng, SIZE_WEIGHTS);
  const jitter = rng(); // used for habitability and other fine-grained variation

  const { score: habitabilityScore, canHostColony } = computeHabitability(
    type,
    size,
    spectralClass,
    jitter,
  );

  const { basicResourceNodes, deepResourceNodes } = generateResourceProfile(
    rng,
    type,
    size,
  );

  return {
    id: bodyId as BodyId,
    index,
    type,
    size,
    habitabilityScore,
    canHostColony,
    basicResourceNodes,
    deepResourceNodes,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pickAnchorBody(bodies: GeneratedBody[]): number {
  // Prefer the body with the highest habitability score as anchor
  let bestIndex = 0;
  let bestScore = -1;
  for (const body of bodies) {
    if (body.habitabilityScore > bestScore) {
      bestScore = body.habitabilityScore;
      bestIndex = body.index;
    }
  }
  return bestIndex;
}
