/**
 * Star catalog lookup utilities.
 *
 * Central access point for catalog data. Currently wraps the static alpha
 * subset. When the full HYG catalog is integrated, replace ALPHA_CATALOG
 * with the larger dataset and update this file only.
 *
 * All functions are pure (no DB access). DB-enriched views are built in
 * the calling server components / API routes.
 */

import type { CatalogEntry } from "@/lib/types/generated";
import { ALPHA_CATALOG } from "./alpha";
import { distanceBetween } from "@/lib/game/travel";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";

// ---------------------------------------------------------------------------
// Catalog map — built once at module init for O(1) lookup
// ---------------------------------------------------------------------------

const CATALOG_MAP = new Map<string, CatalogEntry>(
  ALPHA_CATALOG.map((entry) => [entry.id, entry]),
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Look up a system by its stable catalog ID. Returns undefined if absent. */
export function getCatalogEntry(systemId: string): CatalogEntry | undefined {
  return CATALOG_MAP.get(systemId);
}

/** All catalog entries, sorted by distance from Sol ascending. */
export function getAllCatalogEntries(): ReadonlyArray<CatalogEntry> {
  return ALPHA_CATALOG;
}

/**
 * Nearby system descriptor — catalog data + computed distance from source.
 */
export interface NearbyCatalogEntry {
  id: string;
  name: string;
  spectralClass: CatalogEntry["spectralClass"];
  distanceFromSource: number;
  distanceFromSol: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Return all catalog systems reachable from `fromSystemId` within `maxRangeLy`.
 * Excludes the source system. Sorted by distance ascending.
 *
 * @param fromSystemId  - Stable catalog ID of the origin system.
 * @param maxRangeLy    - Maximum travel distance in light-years.
 */
export function getNearbySystems(
  fromSystemId: string,
  maxRangeLy: number,
): NearbyCatalogEntry[] {
  const from = getCatalogEntry(fromSystemId);
  if (!from) return [];

  const fromPos = { x: from.x, y: from.y, z: from.z };

  return ALPHA_CATALOG.filter((entry) => entry.id !== fromSystemId)
    .map((entry) => ({
      id: entry.id,
      name: entry.properName ?? entry.id,
      spectralClass: entry.spectralClass,
      distanceFromSource: distanceBetween(fromPos, {
        x: entry.x,
        y: entry.y,
        z: entry.z,
      }),
      distanceFromSol:
        entry.id === SOL_SYSTEM_ID
          ? 0
          : distanceBetween(
              { x: 0, y: 0, z: 0 },
              { x: entry.x, y: entry.y, z: entry.z },
            ),
      x: entry.x,
      y: entry.y,
      z: entry.z,
    }))
    .filter((entry) => entry.distanceFromSource <= maxRangeLy)
    .sort((a, b) => a.distanceFromSource - b.distanceFromSource);
}

/**
 * Display name for a system — uses properName if available.
 */
export function systemDisplayName(systemId: string): string {
  const entry = getCatalogEntry(systemId);
  return entry?.properName ?? systemId;
}
