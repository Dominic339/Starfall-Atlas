/**
 * Skin definitions — source of truth for all cosmetic skins in the game.
 *
 * Each skin definition lives here and is synced to the `skins` DB table via
 * the admin dev tool. Adding a skin file here does NOT automatically put it
 * in the shop — an admin must enable it through the dev tool.
 *
 * Visual properties drive how markers are rendered on the galaxy/solar maps.
 * For 2D SVG context:
 *   - Ship skins:    modify the ship marker polygon (color, shape, glow)
 *   - Station skins: modify the station cross/hub marker
 *   - Fleet skins:   modify the fleet triangle marker
 */

export type SkinType = "ship" | "station" | "fleet";
export type SkinRarity = "common" | "uncommon" | "rare" | "legendary";

/** SVG visual overrides applied to a marker when this skin is equipped. */
export interface SkinVisual {
  /** Primary fill color (hex). Defaults to the stock color when omitted. */
  color?: string;
  /** Secondary / accent color (hex). Used for stroke, glow, etc. */
  accentColor?: string;
  /** Glow / filter color applied via SVG filter. */
  glowColor?: string;
  /** Optional CSS animation class to add to the marker group. */
  animationClass?: string;
  /** Shape variant for ship markers: 'chevron' | 'diamond' | 'arrow' | 'delta' */
  shape?: "chevron" | "diamond" | "arrow" | "delta";
  /** Scale multiplier applied to the marker size (default 1). */
  sizeScale?: number;
}

export interface SkinDefinition {
  /** Unique slug — must match the `id` in the `skins` DB table. */
  id: string;
  name: string;
  description: string;
  type: SkinType;
  rarity: SkinRarity;
  visual: SkinVisual;
  /** Path to a .glb 3D model file relative to /public, e.g. "/assets/planets/Basic Station.glb" */
  modelPath?: string;
}

// ---------------------------------------------------------------------------
// Ship skins
// ---------------------------------------------------------------------------

export const SHIP_SKINS: SkinDefinition[] = [
  {
    id: "ship_default",
    name: "Standard Issue",
    description: "The stock ship livery. Clean indigo-on-dark.",
    type: "ship",
    rarity: "common",
    visual: {
      color: "#a5b4fc",
      accentColor: "#6366f1",
      glowColor: "#6366f1",
      shape: "chevron",
    },
  },
  {
    id: "ship_inferno",
    name: "Inferno",
    description: "Blazing red-orange hull with a heated glow. Turns heads in every system.",
    type: "ship",
    rarity: "uncommon",
    visual: {
      color: "#fb923c",
      accentColor: "#ef4444",
      glowColor: "#f97316",
      shape: "chevron",
    },
  },
  {
    id: "ship_void",
    name: "Void Runner",
    description: "Near-invisible matte-black hull with subtle cyan trim. Favored by scouts.",
    type: "ship",
    rarity: "uncommon",
    visual: {
      color: "#22d3ee",
      accentColor: "#0e7490",
      glowColor: "#06b6d4",
      shape: "arrow",
    },
  },
  {
    id: "ship_aurora",
    name: "Aurora",
    description: "Shimmering green-teal gradient reminiscent of northern lights. Rare.",
    type: "ship",
    rarity: "rare",
    visual: {
      color: "#34d399",
      accentColor: "#059669",
      glowColor: "#10b981",
      shape: "delta",
      animationClass: "solar-ship-pulse",
    },
  },
  {
    id: "ship_sovereign",
    name: "Sovereign",
    description:
      "Deep gold with platinum accents. Only the most accomplished commanders fly this.",
    type: "ship",
    rarity: "legendary",
    visual: {
      color: "#fbbf24",
      accentColor: "#d97706",
      glowColor: "#f59e0b",
      shape: "diamond",
      sizeScale: 1.15,
    },
  },
  {
    id: "ship_nebula",
    name: "Nebula Drifter",
    description: "Soft violet-pink tones inspired by distant nebulae.",
    type: "ship",
    rarity: "rare",
    visual: {
      color: "#e879f9",
      accentColor: "#a21caf",
      glowColor: "#d946ef",
      shape: "chevron",
    },
  },
];

// ---------------------------------------------------------------------------
// Station skins
// ---------------------------------------------------------------------------

export const STATION_SKINS: SkinDefinition[] = [
  {
    id: "station_default",
    name: "Standard Hub",
    description: "The default amber station cross.",
    type: "station",
    rarity: "common",
    visual: {
      color: "#fbbf24",
      accentColor: "#f59e0b",
      glowColor: "#f59e0b",
    },
    modelPath: "/assets/planets/Basic Station.glb",
  },
  {
    id: "station_obsidian",
    name: "Obsidian Forge",
    description: "Dark steel-grey hull plating with crimson beacon lights.",
    type: "station",
    rarity: "uncommon",
    visual: {
      color: "#f87171",
      accentColor: "#b91c1c",
      glowColor: "#ef4444",
    },
  },
  {
    id: "station_crystal",
    name: "Crystal Spire",
    description: "Ice-blue crystalline station that refracts star light.",
    type: "station",
    rarity: "rare",
    visual: {
      color: "#7dd3fc",
      accentColor: "#0284c7",
      glowColor: "#38bdf8",
    },
  },
  {
    id: "station_golden_age",
    name: "Golden Age",
    description: "Gleaming gold with ornate trim — a monument to prosperity.",
    type: "station",
    rarity: "legendary",
    visual: {
      color: "#fde68a",
      accentColor: "#b45309",
      glowColor: "#fbbf24",
      sizeScale: 1.1,
    },
  },
];

// ---------------------------------------------------------------------------
// Fleet skins
// ---------------------------------------------------------------------------

export const FLEET_SKINS: SkinDefinition[] = [
  {
    id: "fleet_default",
    name: "Standard Fleet",
    description: "Stock violet fleet marker.",
    type: "fleet",
    rarity: "common",
    visual: {
      color: "#c4b5fd",
      accentColor: "#7c3aed",
      glowColor: "#a78bfa",
    },
  },
  {
    id: "fleet_ironclad",
    name: "Ironclad",
    description: "Heavy grey-blue armored fleet marking. Signals strength.",
    type: "fleet",
    rarity: "uncommon",
    visual: {
      color: "#93c5fd",
      accentColor: "#1d4ed8",
      glowColor: "#60a5fa",
    },
  },
  {
    id: "fleet_crimson_tide",
    name: "Crimson Tide",
    description: "Blood-red fleet marker. Your enemies will know you're coming.",
    type: "fleet",
    rarity: "rare",
    visual: {
      color: "#fca5a5",
      accentColor: "#dc2626",
      glowColor: "#f87171",
    },
  },
  {
    id: "fleet_emerald_vanguard",
    name: "Emerald Vanguard",
    description: "Emerald green elite fleet sigil. Rare prestige marker.",
    type: "fleet",
    rarity: "legendary",
    visual: {
      color: "#6ee7b7",
      accentColor: "#047857",
      glowColor: "#34d399",
      sizeScale: 1.1,
    },
  },
];

// ---------------------------------------------------------------------------
// All skins flat list
// ---------------------------------------------------------------------------

export const ALL_SKINS: SkinDefinition[] = [
  ...SHIP_SKINS,
  ...STATION_SKINS,
  ...FLEET_SKINS,
];

export function getSkinById(id: string): SkinDefinition | undefined {
  return ALL_SKINS.find((s) => s.id === id);
}

export function getSkinsByType(type: SkinType): SkinDefinition[] {
  return ALL_SKINS.filter((s) => s.type === type);
}

export const RARITY_ORDER: Record<SkinRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  legendary: 3,
};

export const RARITY_LABEL: Record<SkinRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  legendary: "Legendary",
};

export const RARITY_COLOR: Record<SkinRarity, string> = {
  common:    "#9ca3af", // zinc-400
  uncommon:  "#34d399", // emerald-400
  rare:      "#818cf8", // indigo-400
  legendary: "#fbbf24", // amber-400
};
