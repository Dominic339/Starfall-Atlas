import { describe, it, expect } from "vitest";
import { generateSystem } from "../generation";
import type { CatalogEntry } from "@/lib/types/generated";

// Minimal stub CatalogEntry for testing
const STUB_ENTRY: CatalogEntry = {
  id:            "hyg:70890",
  properName:    "Alpha Centauri A",
  hipId:         null,
  spectralClass: "G",
  x: 0,
  y: 0,
  z: 0,
  distance: 4.37,
};

describe("generateSystem", () => {
  it("is deterministic — same system_id always produces identical output", () => {
    const r1 = generateSystem("hyg:70890", STUB_ENTRY);
    const r2 = generateSystem("hyg:70890", STUB_ENTRY);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("different system IDs produce different outputs", () => {
    const r1 = generateSystem("hyg:70890", STUB_ENTRY);
    const r2 = generateSystem("hyg:99999", { ...STUB_ENTRY, id: "hyg:99999" });
    expect(r1.id).not.toBe(r2.id);
  });

  it("returns the correct system id", () => {
    const result = generateSystem("test-system", STUB_ENTRY);
    expect(result.id).toBe("test-system");
  });

  it("produces at least one body", () => {
    const result = generateSystem("hyg:70890", STUB_ENTRY);
    expect(result.bodies.length).toBeGreaterThan(0);
  });

  it("bodyCount matches actual bodies array length", () => {
    const result = generateSystem("hyg:70890", STUB_ENTRY);
    expect(result.bodyCount).toBe(result.bodies.length);
  });

  it("each body has a valid id scoped to the system", () => {
    const result = generateSystem("hyg:70890", STUB_ENTRY);
    for (const body of result.bodies) {
      expect(body.id).toMatch(/^hyg:70890:\d+$/);
    }
  });

  it("body indices are sequential starting at 0", () => {
    const result = generateSystem("hyg:70890", STUB_ENTRY);
    result.bodies.forEach((b, i) => {
      expect(b.id).toBe(`hyg:70890:${i}`);
      expect(b.index).toBe(i);
    });
  });

  it("basic resource nodes have positive quantities", () => {
    const result = generateSystem("hyg:70890", STUB_ENTRY);
    for (const body of result.bodies) {
      for (const node of body.basicResourceNodes) {
        expect(node.quantity).toBeGreaterThan(0);
      }
    }
  });

  it("deep resource nodes have positive quantities when present", () => {
    const result = generateSystem("hyg:70890", STUB_ENTRY);
    for (const body of result.bodies) {
      for (const node of body.deepResourceNodes) {
        expect(node.quantity).toBeGreaterThan(0);
      }
    }
  });

  it("habitabilityScore is in valid range [0, 100]", () => {
    const result = generateSystem("hyg:70890", STUB_ENTRY);
    for (const body of result.bodies) {
      expect(body.habitabilityScore).toBeGreaterThanOrEqual(0);
      expect(body.habitabilityScore).toBeLessThanOrEqual(100);
    }
  });

  it("canHostColony is true iff habitabilityScore >= 60", () => {
    const result = generateSystem("hyg:70890", STUB_ENTRY);
    for (const body of result.bodies) {
      expect(body.canHostColony).toBe(body.habitabilityScore >= 60);
    }
  });

  it("all body types are valid enum values", () => {
    const validBodyTypes = new Set([
      "lush", "ocean", "desert", "ice_planet", "volcanic", "toxic",
      "rocky", "habitable", "gas_giant", "ice_giant", "asteroid_belt",
      "barren", "frozen",
    ]);
    const result = generateSystem("hyg:70890", STUB_ENTRY);
    for (const body of result.bodies) {
      expect(validBodyTypes.has(body.type)).toBe(true);
    }
  });

  it("anchorBodyIndex is within bounds", () => {
    const result = generateSystem("hyg:70890", STUB_ENTRY);
    expect(result.anchorBodyIndex).toBeGreaterThanOrEqual(0);
    expect(result.anchorBodyIndex).toBeLessThan(result.bodies.length);
  });

  it("stability — same 10 systems produce same body counts across calls", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const first  = ids.map((id) => generateSystem(id, { ...STUB_ENTRY, id }).bodyCount);
    const second = ids.map((id) => generateSystem(id, { ...STUB_ENTRY, id }).bodyCount);
    expect(first).toEqual(second);
  });

  it("G-type and M-type stars are both valid", () => {
    const gResult = generateSystem("g-star", { ...STUB_ENTRY, spectralClass: "G" });
    const mResult = generateSystem("m-star", { ...STUB_ENTRY, spectralClass: "M" });
    expect(gResult.bodies.length).toBeGreaterThan(0);
    expect(mResult.bodies.length).toBeGreaterThan(0);
  });
});
