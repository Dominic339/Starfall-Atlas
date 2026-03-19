/**
 * Seeded pseudo-random number generator.
 *
 * Uses the Mulberry32 algorithm: fast, good quality, deterministic.
 * A string seed is hashed to a 32-bit integer using FNV-1a.
 *
 * Critical invariant: the same seed always produces the same sequence.
 * Tests must verify this — see src/__tests__/rng.test.ts.
 */

/**
 * Hash an arbitrary string to a 32-bit unsigned integer using FNV-1a.
 * Deterministic across all environments (no locale or engine differences).
 */
export function hashStringToSeed(input: string): number {
  let hash = 2166136261; // FNV offset basis (32-bit)
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by FNV prime (32-bit), keeping only lower 32 bits
    hash = Math.imul(hash, 16777619);
    hash >>>= 0; // convert to unsigned 32-bit
  }
  return hash;
}

/**
 * Create a Mulberry32 PRNG from a numeric seed.
 * Returns a function that, when called, produces the next float in [0, 1).
 *
 * @example
 * const rng = mulberry32(42);
 * rng(); // 0.6235... (always the same for seed=42)
 * rng(); // 0.2341... (always the same on the second call)
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded RNG from a string identifier.
 * Combines hashing + Mulberry32 for a single convenient entry point.
 */
export function seededRng(id: string): () => number {
  return mulberry32(hashStringToSeed(id));
}

/**
 * Pick a random integer in [min, max] (inclusive) using the given RNG.
 */
export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Pick a weighted random item from an array of { value, weight } pairs.
 * Weights do not need to sum to any specific value.
 */
export function weightedPick<T>(
  rng: () => number,
  options: ReadonlyArray<{ value: T; weight: number }>,
): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let cursor = rng() * total;
  for (const option of options) {
    cursor -= option.weight;
    if (cursor <= 0) return option.value;
  }
  // Fallback (floating-point edge case): return last option
  return options[options.length - 1].value;
}
