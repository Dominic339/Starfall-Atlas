/**
 * Alliance territory geometry — Phase 24.
 *
 * Links, loop detection, territory polygon derivation, and system-in-territory
 * classification are all computed server-side from beacon positions.
 *
 * Design choices (alpha):
 *   LINKS    — Derived dynamically: two beacons from the same alliance are
 *              linked if their 2D (x, y) catalog-space distance is
 *              ≤ BALANCE.alliance.beaconLinkMaxDistanceLy.  No link rows are
 *              persisted; they are always recomputed from beacon positions.
 *
 *   TERRITORY — Each alliance's territory is the convex hull of all its beacon
 *               positions (in 2D catalog space).  The hull is valid (becomes a
 *               rendered territory polygon) only when:
 *                 (a) the hull has ≥ 3 vertices, AND
 *                 (b) every consecutive hull edge is ≤ maxLinkDistanceLy.
 *               Condition (b) ensures that the territory boundary is a
 *               fully-connected beacon loop — not a "stretched" hull that
 *               spans a gap too large to be linked.
 *
 *   OVERLAP   — Alpha rule: no suppression.  If two alliances' territory
 *               polygons overlap, both are rendered at low opacity.  Dispute
 *               resolution is deferred to a later phase.
 *
 *   SYSTEMS INSIDE — Standard 2D ray-casting point-in-polygon test applied to
 *                    every catalog system center against each valid hull.
 *                    Systems exactly on the boundary are treated as outside
 *                    (tie-breaking in the casting algorithm).
 *
 * All coordinate arithmetic uses 2D (x, y) catalog space (light-years from
 * Sol, ignoring z).  The SVG projection is a linear transform of this space,
 * so convexity, containment, and link distances are all preserved after
 * projection.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BeaconInput {
  id: string;
  allianceId: string;
  systemId: string;
}

/** A 2D point in catalog space (light-years from Sol, ignoring z). */
export interface CatalogPoint2D {
  systemId: string;
  x: number;
  y: number;
}

export interface BeaconLink {
  fromSystemId: string;
  toSystemId: string;
}

export interface AllianceTerritoryResult {
  allianceId: string;
  allianceTag: string;
  allianceName: string;

  /**
   * All pairwise beacon links for this alliance (pairs within maxLinkDistanceLy).
   * Used to render link lines on the map.
   */
  links: BeaconLink[];

  /**
   * Convex hull of beacon positions in catalog 2D space.
   * Empty if the territory is invalid (< 3 hull vertices, or a hull edge
   * exceeds maxLinkDistanceLy).
   */
  hullCatalog: CatalogPoint2D[];

  /**
   * True when a valid closed territory polygon exists.
   * Equivalent to hullCatalog.length >= 3.
   */
  hasValidTerritory: boolean;

  /**
   * Catalog system IDs whose centers fall inside the territory polygon.
   * Empty when hasValidTerritory is false.
   */
  systemsInTerritory: string[];
}

// ---------------------------------------------------------------------------
// Internal geometry helpers
// ---------------------------------------------------------------------------

function dist2D(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * 2D cross product of vectors OA and OB.
 * > 0 → counter-clockwise turn
 * = 0 → collinear
 * < 0 → clockwise turn
 */
function cross(
  o: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Graham scan convex hull.
 *
 * Returns hull vertices in counter-clockwise order.
 * Returns [] when < 3 distinct input points (no polygon is possible).
 * Collinear points on hull edges are excluded (strict left-turn condition).
 */
function convexHull(points: CatalogPoint2D[]): CatalogPoint2D[] {
  // Deduplicate by systemId
  const unique = points.filter(
    (p, i) => points.findIndex((q) => q.systemId === p.systemId) === i,
  );
  if (unique.length < 3) return [];

  // Sort lexicographically by (x, y) for deterministic hull computation
  const sorted = [...unique].sort((a, b) =>
    a.x !== b.x ? a.x - b.x : a.y - b.y,
  );

  const hull: CatalogPoint2D[] = [];

  // Lower hull (left to right)
  for (const p of sorted) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
      hull.pop();
    }
    hull.push(p);
  }

  // Upper hull (right to left)
  const lowerLen = hull.length + 1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (hull.length >= lowerLen && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
      hull.pop();
    }
    hull.push(p);
  }

  // Last element duplicates first; remove it
  hull.pop();
  return hull.length >= 3 ? hull : [];
}

/**
 * Ray-casting point-in-polygon test (2D).
 * A point on the boundary is treated as outside (even crossing rule).
 * Handles non-convex polygons correctly (not needed for convex hulls but
 * included for correctness).
 */
function pointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const { x: xi, y: yi } = polygon[i];
    const { x: xj, y: yj } = polygon[j];
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Computes alliance territory data for all alliances that have active beacons.
 *
 * @param beacons         All active beacons across all alliances.
 * @param alliances       Map of allianceId → { name, tag }.
 * @param catalogBySystem Map of systemId → { x, y } catalog 2D coordinates.
 * @param allSystems      All catalog system points (for PIP classification).
 * @param maxLinkDist     Maximum 2D catalog-space distance for a valid link/hull-edge (ly).
 */
export function computeAllTerritories({
  beacons,
  alliances,
  catalogBySystem,
  allSystems,
  maxLinkDist,
}: {
  beacons: BeaconInput[];
  alliances: Map<string, { name: string; tag: string }>;
  catalogBySystem: Map<string, { x: number; y: number }>;
  allSystems: CatalogPoint2D[];
  maxLinkDist: number;
}): AllianceTerritoryResult[] {
  // ── Group beacons by alliance ───────────────────────────────────────────
  const byAlliance = new Map<string, BeaconInput[]>();
  for (const b of beacons) {
    const list = byAlliance.get(b.allianceId) ?? [];
    list.push(b);
    byAlliance.set(b.allianceId, list);
  }

  const results: AllianceTerritoryResult[] = [];

  for (const [allianceId, allianceBeacons] of byAlliance) {
    const info = alliances.get(allianceId);
    if (!info) continue;

    // ── Resolve 2D positions for this alliance's beacons ───────────────────
    const positions: CatalogPoint2D[] = [];
    for (const b of allianceBeacons) {
      const pos = catalogBySystem.get(b.systemId);
      if (pos) positions.push({ systemId: b.systemId, x: pos.x, y: pos.y });
    }
    if (positions.length === 0) continue;

    // ── Compute links (all pairs within maxLinkDist) ───────────────────────
    const links: BeaconLink[] = [];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        if (dist2D(positions[i], positions[j]) <= maxLinkDist) {
          links.push({
            fromSystemId: positions[i].systemId,
            toSystemId: positions[j].systemId,
          });
        }
      }
    }

    // ── Convex hull ────────────────────────────────────────────────────────
    const hull = convexHull(positions);

    // ── Validate hull: every hull edge must be ≤ maxLinkDist ──────────────
    let hasValidTerritory = hull.length >= 3;
    if (hasValidTerritory) {
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        if (dist2D(a, b) > maxLinkDist) {
          hasValidTerritory = false;
          break;
        }
      }
    }

    // ── Point-in-polygon classification ───────────────────────────────────
    const systemsInTerritory: string[] = [];
    if (hasValidTerritory) {
      for (const sys of allSystems) {
        if (pointInPolygon(sys, hull)) {
          systemsInTerritory.push(sys.systemId);
        }
      }
    }

    results.push({
      allianceId,
      allianceTag: info.tag,
      allianceName: info.name,
      links,
      hullCatalog: hasValidTerritory ? hull : [],
      hasValidTerritory,
      systemsInTerritory,
    });
  }

  return results;
}
