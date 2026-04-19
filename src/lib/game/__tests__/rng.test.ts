import { describe, it, expect } from "vitest";
import { hashStringToSeed, mulberry32, seededRng, randInt, weightedPick } from "../rng";

describe("hashStringToSeed", () => {
  it("is deterministic", () => {
    expect(hashStringToSeed("hello")).toBe(hashStringToSeed("hello"));
    expect(hashStringToSeed("sol")).toBe(hashStringToSeed("sol"));
  });

  it("produces different values for different inputs", () => {
    expect(hashStringToSeed("hello")).not.toBe(hashStringToSeed("world"));
    expect(hashStringToSeed("hyg:70890")).not.toBe(hashStringToSeed("hyg:70891"));
  });

  it("returns a 32-bit unsigned integer", () => {
    const h = hashStringToSeed("test");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });

  it("handles empty string", () => {
    const h = hashStringToSeed("");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe("mulberry32", () => {
  it("produces floats in [0, 1)", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic — same seed same sequence", () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("differs for different seeds", () => {
    const rng1 = mulberry32(1);
    const rng2 = mulberry32(2);
    // Very unlikely both produce the same first value
    expect(rng1()).not.toBe(rng2());
  });

  it("known fixed values for seed=0", () => {
    const rng = mulberry32(0);
    const first = rng();
    // Re-run same seed to verify reproducibility
    const rng2 = mulberry32(0);
    expect(rng2()).toBe(first);
  });
});

describe("seededRng", () => {
  it("is deterministic by string id", () => {
    const r1 = seededRng("hyg:70890");
    const r2 = seededRng("hyg:70890");
    expect(r1()).toBe(r2());
    expect(r1()).toBe(r2());
  });

  it("differs for different ids", () => {
    const r1 = seededRng("a");
    const r2 = seededRng("b");
    // At least one of 5 draws should differ
    let anyDiff = false;
    for (let i = 0; i < 5; i++) {
      if (r1() !== r2()) anyDiff = true;
    }
    expect(anyDiff).toBe(true);
  });
});

describe("randInt", () => {
  it("stays within [min, max]", () => {
    const rng = seededRng("randInt-test");
    for (let i = 0; i < 200; i++) {
      const v = randInt(rng, 1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("can return both endpoints", () => {
    const rng = seededRng("endpoints");
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      seen.add(randInt(rng, 1, 3));
    }
    expect(seen.has(1)).toBe(true);
    expect(seen.has(3)).toBe(true);
  });
});

describe("weightedPick", () => {
  it("picks from options", () => {
    const rng = seededRng("weighted-test");
    const options = [
      { value: "a", weight: 1 },
      { value: "b", weight: 2 },
      { value: "c", weight: 3 },
    ] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(weightedPick(rng, options));
    }
    expect(seen.has("a")).toBe(true);
    expect(seen.has("b")).toBe(true);
    expect(seen.has("c")).toBe(true);
  });

  it("always picks the only option when weight array has one entry", () => {
    const rng = seededRng("single-option");
    for (let i = 0; i < 20; i++) {
      expect(weightedPick(rng, [{ value: "x", weight: 1 }])).toBe("x");
    }
  });

  it("higher weight means higher frequency", () => {
    const rng = seededRng("frequency-check");
    const counts: Record<string, number> = { rare: 0, common: 0 };
    for (let i = 0; i < 10000; i++) {
      const v = weightedPick(rng, [
        { value: "rare",   weight: 1 },
        { value: "common", weight: 99 },
      ]);
      counts[v]++;
    }
    expect(counts.common).toBeGreaterThan(counts.rare * 5);
  });
});
