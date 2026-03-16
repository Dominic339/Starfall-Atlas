/**
 * Habitability scoring for system bodies.
 *
 * A body needs habitabilityScore >= 60 to host a standard colony.
 * This threshold matches GAME_RULES.md §4.1 (colony site requirements).
 *
 * Scores are deterministic from body type, size, and the body's seed.
 * A player's colony structures can eventually lower the required score
 * (future phases), but the raw score never changes.
 */

import type { SpectralClass, BodyType } from "@/lib/types/enums";
import type { BodySize } from "@/lib/types/generated";

export const COLONY_HABITABILITY_THRESHOLD = 60;

// ---------------------------------------------------------------------------
// Base habitability by body type
// ---------------------------------------------------------------------------

const BASE_SCORE: Record<BodyType, number> = {
  habitable:     75,
  rocky:         30,
  barren:        15,
  frozen:        10,
  asteroid_belt:  5,
  gas_giant:      0,
  ice_giant:      0,
};

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

const SIZE_MODIFIER: Record<BodySize, number> = {
  tiny:   -15,
  small:   -5,
  medium:   0,
  large:    5,
  huge:    -5, // too massive, difficult to settle
};

/**
 * Stars closer to Sol's spectral class produce more hospitable conditions.
 * G-type (like Sol) is the sweet spot. O/B stars are too harsh.
 */
const SPECTRAL_MODIFIER: Record<SpectralClass, number> = {
  G:  10,
  F:   5,
  K:   5,
  A:  -5,
  M:  -3,
  B: -20,
  O: -30,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HabitabilityResult {
  score: number;
  canHostColony: boolean;
}

/**
 * Compute the habitability score for a body.
 * The seed jitter (-5 to +5) adds per-body variation without changing
 * the overall distribution, keeping the system meaningful while adding variety.
 */
export function computeHabitability(
  bodyType: BodyType,
  bodySize: BodySize,
  spectralClass: SpectralClass,
  seedJitter: number, // deterministic 0–1 float from body rng
): HabitabilityResult {
  const base = BASE_SCORE[bodyType];
  const sizeMod = SIZE_MODIFIER[bodySize];
  const spectralMod = SPECTRAL_MODIFIER[spectralClass];
  const jitter = Math.round((seedJitter - 0.5) * 10); // ±5

  const score = Math.max(0, Math.min(100, base + sizeMod + spectralMod + jitter));

  return {
    score,
    canHostColony: score >= COLONY_HABITABILITY_THRESHOLD,
  };
}
