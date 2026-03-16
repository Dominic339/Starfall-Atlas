/**
 * Types for deterministic (seed-generated) world data.
 * These values are NEVER stored in Supabase — they are always computed
 * on demand from the star catalog seed. See src/lib/game/generation.ts.
 */

import type { SpectralClass, BodyType, ResourceType } from "./enums";
import type { SystemId, BodyId } from "./game";

// ---------------------------------------------------------------------------
// Generated system data
// ---------------------------------------------------------------------------

export interface GeneratedSystem {
  /** Stable catalog-derived system ID */
  id: SystemId;
  /** Reproducible seed integer derived from system_id */
  seed: number;
  /** Human-readable name (generated if not in catalog) */
  name: string;
  spectralClass: SpectralClass;
  /** Approximate position in light-years from Sol */
  positionLy: { x: number; y: number; z: number };
  /** Distance from Sol in light-years */
  distanceFromSolLy: number;
  /** Number of bodies in the system */
  bodyCount: number;
  bodies: GeneratedBody[];
  /** Index of the "anchor point" body that grants system ownership when claimed */
  anchorBodyIndex: number;
}

// ---------------------------------------------------------------------------
// Generated body data
// ---------------------------------------------------------------------------

export interface GeneratedBody {
  /** Stable body ID: "{system_id}:{index}" */
  id: BodyId;
  /** Zero-based index within the system */
  index: number;
  type: BodyType;
  size: BodySize;
  /** 0–100 score; ≥ 60 required for colony without special structures */
  habitabilityScore: number;
  /** Shortcut: habitabilityScore >= 60 */
  canHostColony: boolean;
  /** Resource nodes visible after a basic survey */
  basicResourceNodes: GeneratedResourceNode[];
  /** Additional rare nodes revealed only by a deep survey (premium item) */
  deepResourceNodes: GeneratedResourceNode[];
}

export type BodySize = "tiny" | "small" | "medium" | "large" | "huge";

// ---------------------------------------------------------------------------
// Generated resource node
// ---------------------------------------------------------------------------

export interface GeneratedResourceNode {
  type: ResourceType;
  /** Total extractable quantity (integer units) */
  quantity: number;
  isRare: boolean;
}

// ---------------------------------------------------------------------------
// Survey summary (combines DB result with generated node data)
// ---------------------------------------------------------------------------

/**
 * What a player sees after surveying a body.
 * basic nodes always shown; rare nodes shown only if has_deep_nodes = true.
 */
export interface SurveySummary {
  bodyId: BodyId;
  systemId: SystemId;
  basicNodes: GeneratedResourceNode[];
  rareNodes: GeneratedResourceNode[];
  hasDeepSurvey: boolean;
  firstSurveyedAt: string;
}

// ---------------------------------------------------------------------------
// Catalog entry (for when the real catalog is plugged in)
// ---------------------------------------------------------------------------

/**
 * Minimal structure for a catalog star entry.
 * The real HYG catalog fields map to this interface.
 * Used in src/lib/game/generation.ts to override generated values.
 */
export interface CatalogEntry {
  id: string;
  properName: string | null;
  hipId: number | null;
  spectralClass: SpectralClass;
  x: number;
  y: number;
  z: number;
  distance: number;
}
