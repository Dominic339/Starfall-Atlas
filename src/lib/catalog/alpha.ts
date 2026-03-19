/**
 * Alpha star catalog — Sol and all confirmed stars within ~11 ly.
 *
 * Used for Phase 4 development. Replaces or extends with the full
 * HYG Star Database v3 (https://github.com/astronexus/HYG-Database)
 * when catalog integration is complete.
 *
 * Coordinates are heliocentric equatorial, in light-years from Sol.
 * x = toward vernal equinox (RA=0h, Dec=0°)
 * y = toward RA=6h, Dec=0°
 * z = toward north celestial pole
 * Approximate to ±0.05 ly; computed from published RA/Dec/parallax.
 *
 * Sol is included with id="sol" so distance calculations from Sol work.
 */

import type { CatalogEntry } from "@/lib/types/generated";

/**
 * Static alpha catalog — 13 systems.
 * Within 10 ly of Sol: reachable at game start (base travel range).
 * 10–11 ly: reachable once relay stations extend range.
 */
export const ALPHA_CATALOG: ReadonlyArray<CatalogEntry> = [
  // ── Sol ────────────────────────────────────────────────────────────────────
  {
    id: "sol",
    properName: "Sol",
    hipId: null,
    spectralClass: "G",
    x: 0,
    y: 0,
    z: 0,
    distance: 0,
  },

  // ── Within 10 ly — directly reachable from Sol at game start ──────────────

  // Proxima Centauri — 4.24 ly, M5.5 Ve
  // RA 14h 29m 43s, Dec −62° 40′ 46″  (HIP 70890)
  {
    id: "hyg:70890",
    properName: "Proxima Centauri",
    hipId: 70890,
    spectralClass: "M",
    x: -1.53,
    y: -1.17,
    z: -3.77,
    distance: 4.24,
  },

  // Alpha Centauri A (Rigil Kentaurus) — 4.37 ly, G2 V
  // RA 14h 39m 36s, Dec −60° 50′ 02″  (HIP 71683)
  {
    id: "hyg:71683",
    properName: "Rigil Kentaurus",
    hipId: 71683,
    spectralClass: "G",
    x: -1.64,
    y: -1.36,
    z: -3.82,
    distance: 4.37,
  },

  // Barnard's Star — 5.96 ly, M4 Ve
  // RA 17h 57m 48s, Dec +04° 41′ 36″  (HIP 87937)
  {
    id: "hyg:87937",
    properName: "Barnard's Star",
    hipId: 87937,
    spectralClass: "M",
    x: -0.08,
    y: -5.95,
    z: 0.49,
    distance: 5.96,
  },

  // Wolf 359 — 7.78 ly, M6 Ve
  // RA 10h 56m 29s, Dec +07° 00′ 53″  (HIP 54035)
  {
    id: "hyg:54035",
    properName: "Wolf 359",
    hipId: 54035,
    spectralClass: "M",
    x: -7.42,
    y: 2.13,
    z: 0.95,
    distance: 7.78,
  },

  // Lalande 21185 — 8.29 ly, M2 V
  // RA 11h 03m 20s, Dec +35° 58′ 12″  (HIP 53020)
  {
    id: "hyg:53020",
    properName: "Lalande 21185",
    hipId: 53020,
    spectralClass: "M",
    x: -6.51,
    y: 1.66,
    z: 4.87,
    distance: 8.29,
  },

  // Sirius A — 8.60 ly, A1 Vm
  // RA 06h 45m 09s, Dec −16° 42′ 58″  (HIP 32349)
  {
    id: "hyg:32349",
    properName: "Sirius",
    hipId: 32349,
    spectralClass: "A",
    x: -1.60,
    y: 8.07,
    z: -2.47,
    distance: 8.60,
  },

  // Luyten 726-8 (BL Ceti) — 8.73 ly, M5.5 Ve + M6 Ve
  // RA 01h 39m 01s, Dec −17° 57′ 01″  (HIP 1013)
  {
    id: "hyg:1013",
    properName: "Luyten 726-8",
    hipId: 1013,
    spectralClass: "M",
    x: 7.53,
    y: 3.47,
    z: -2.69,
    distance: 8.73,
  },

  // Ross 154 — 9.69 ly, M3.5 Ve
  // RA 18h 49m 49s, Dec −23° 50′ 10″  (HIP 92403)
  {
    id: "hyg:92403",
    properName: "Ross 154",
    hipId: 92403,
    spectralClass: "M",
    x: 1.90,
    y: -8.64,
    z: -3.91,
    distance: 9.69,
  },

  // ── 10–11 ly — reachable after relay station construction ─────────────────

  // Ross 248 — 10.32 ly, M6 Ve
  // RA 23h 41m 55s, Dec +44° 10′ 41″  (HIP 114110)
  {
    id: "hyg:114110",
    properName: "Ross 248",
    hipId: 114110,
    spectralClass: "M",
    x: 7.35,
    y: -0.62,
    z: 7.20,
    distance: 10.32,
  },

  // Epsilon Eridani — 10.52 ly, K2 V
  // RA 03h 32m 56s, Dec −09° 27′ 30″  (HIP 16537)
  {
    id: "hyg:16537",
    properName: "Epsilon Eridani",
    hipId: 16537,
    spectralClass: "K",
    x: 6.24,
    y: 8.28,
    z: -1.72,
    distance: 10.52,
  },

  // Lacaille 9352 — 10.74 ly, M1/M2 Ve
  // RA 23h 05m 52s, Dec −35° 51′ 11″  (HIP 114046)
  {
    id: "hyg:114046",
    properName: "Lacaille 9352",
    hipId: 114046,
    spectralClass: "M",
    x: 8.45,
    y: -2.08,
    z: -6.29,
    distance: 10.74,
  },

  // Ross 128 — 10.92 ly, M4 V
  // RA 11h 47m 44s, Dec +00° 48′ 16″  (HIP 57548)
  {
    id: "hyg:57548",
    properName: "Ross 128",
    hipId: 57548,
    spectralClass: "M",
    x: -10.90,
    y: 0.61,
    z: 0.15,
    distance: 10.92,
  },
];
