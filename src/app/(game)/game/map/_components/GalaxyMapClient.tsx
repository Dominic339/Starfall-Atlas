"use client";

/**
 * GalaxyMapClient — Phase 19 interactive 2D galaxy navigation map.
 *
 * Features:
 *   - SVG map with pan (drag) and zoom (scroll/trackpad)
 *   - All alpha-catalog systems shown at real heliocentric coordinates
 *   - Visual encoding: spectral color, discovery state, colonies, ship/fleet markers
 *   - Travel range circle around current ship location
 *   - Hover tooltip: system name + key stats
 *   - Click to select a system → right panel with details
 *   - "Open System" → /game/system/[id]
 *   - "Travel Here" → POST /api/game/travel (server-authoritative), then dashboard
 *   - Zoom-to-cursor, clamped scale
 *   - Reset view button
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types (exported so page.tsx can import them)
// ---------------------------------------------------------------------------

export interface GalaxySystem {
  id: string;
  name: string;
  spectralClass: string;
  /** Catalog heliocentric coordinates (ly from Sol) */
  x: number;
  y: number;
  z: number;
  distanceFromSol: number;
  /** Pre-projected SVG base coordinates */
  svgX: number;
  svgY: number;
  isDiscovered: boolean;
  isPlayerSteward: boolean;
  /** Human-readable discoverer handle, if known. */
  discovererHandle: string | null;
  /** Player's active colony count in this system */
  colonyCount: number;
  /** Number of planetary/stellar bodies in this system */
  bodyCount: number;
  /** Player ship is docked here */
  hasDockedShip: boolean;
  /** Player fleet is docked here */
  hasDockedFleet: boolean;
  /** This is where the primary docked ship is (travel source) */
  isCurrentLocation: boolean;
  /** Player's station is located here */
  isStationLocation: boolean;
  /** A ship is currently traveling to this system */
  isInTransitTarget: boolean;
  /** A ship departed from this system and is currently in transit */
  isTransitOrigin: boolean;
}

export interface GalaxyShip {
  id: string;
  name: string;
  systemId: string | null;
  /** Populated when ship is currently in transit (current_system_id = null). */
  destinationSystemId: string | null;
  /** ISO timestamp of expected arrival; null when not in transit. */
  arriveAt: string | null;
  /** "manual" | "auto_collect_nearest" | "auto_collect_highest" */
  dispatchMode: string;
  /** "idle" | "traveling_to_colony" | "traveling_to_station" | null */
  autoState: string | null;
  speedLyPerHr: number;
  cargoCap: number;
  /**
   * System ID of the player's pinned colony for this ship (derived server-side
   * from pinned_colony_id → colonies.system_id). Null when unassigned.
   */
  pinnedColonySystemId: string | null;
}

export interface GalaxyFleet {
  id: string;
  name: string;
  systemId: string | null;
  /** True if this fleet currently has an active asteroid harvest job. */
  isHarvesting: boolean;
}

export interface GalaxyAsteroid {
  id: string;
  systemId: string;
  /** Pre-computed SVG coordinates (system position + display offset). */
  svgX: number;
  svgY: number;
  resourceType: string;
  totalAmount: number;
  remainingAmount: number;
  status: "active" | "depleted" | "expired";
  /** Player's active harvest id on this asteroid, or null if none. */
  myHarvestId: string | null;
}

/** One alliance beacon visible on the galaxy map. */
export interface GalaxyBeacon {
  id: string;
  systemId: string;
  allianceId: string;
  allianceTag: string;
  allianceName: string;
}

/** An active beacon dispute visible on the galaxy map. */
export interface GalaxyDispute {
  id: string;
  beaconId: string;
  beaconSystemId: string;
  defendingAllianceId: string;
  defendingAllianceTag: string;
  attackingAllianceId: string;
  attackingAllianceTag: string;
  resolvesAt: string;
}

/**
 * Pre-computed territory data for one alliance.
 * SVG-space coordinates are computed server-side and passed directly to avoid
 * duplicate projection logic in the client component.
 */
export interface GalaxyTerritory {
  allianceId: string;
  allianceTag: string;
  allianceName: string;
  /** SVG-space polygon vertices for the territory fill. Empty = no valid territory. */
  svgPolygon: { x: number; y: number }[];
  /** Catalog system IDs whose centers lie inside the territory polygon. */
  systemIds: string[];
  /** SVG-space link lines between connected beacon systems. */
  links: { x1: number; y1: number; x2: number; y2: number }[];
}

/**
 * A ship or fleet travel line: from one system to another.
 * SVG coordinates are computed server-side.
 */
export interface GalaxyTravelLine {
  /** Unique key for React */
  key: string;
  /** SVG position of the origin system */
  x1: number;
  y1: number;
  /** SVG position of the destination system */
  x2: number;
  y2: number;
  /** System IDs for origin/destination (used for selected-system highlighting). */
  fromSystemId: string;
  toSystemId: string;
  /** Short label shown near midpoint (e.g. ship name) */
  label: string;
  /** True = fleet travel (slightly different styling) */
  isFleet: boolean;
  /** ISO timestamps for ETA display and ship-position interpolation. */
  arriveAt: string | null;
  departAt: string | null;
}

interface GalaxyMapClientProps {
  systems: GalaxySystem[];
  ships: GalaxyShip[];
  fleets: GalaxyFleet[];
  asteroids: GalaxyAsteroid[];
  beacons: GalaxyBeacon[];
  territories: GalaxyTerritory[];
  disputes: GalaxyDispute[];
  /** Active travel lines (ship/fleet in-transit paths). */
  travelLines: GalaxyTravelLine[];
  pixelsPerLy: number;
  baseRangeLy: number;
  viewboxW: number;
  viewboxH: number;
  /** Station 3D coordinates for distance-from-station computation. */
  stationCoords: { x: number; y: number; z: number } | null;
  /** Player's alliance ID, null if not in an alliance. */
  playerAllianceId: string | null;
  /** True if the player has officer/founder role (can place beacons). */
  canPlaceBeacon: boolean;
  /** System IDs where the player's alliance already has an active beacon. */
  playerAllianceBeaconSystemIds: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 8;
const ZOOM_STEP = 0.12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spectralColor(cls: string): string {
  switch (cls) {
    case "O":
    case "B": return "#93c5fd"; // blue-300
    case "A": return "#bfdbfe"; // blue-200
    case "F": return "#fef3c7"; // amber-100
    case "G": return "#fde68a"; // amber-200 (Sol-like)
    case "K": return "#fdba74"; // orange-300
    case "M": return "#fca5a5"; // red-300
    default:  return "#d1d5db"; // gray-300
  }
}

/** 3D Euclidean distance between two catalog positions. */
function dist3D(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function formatDist(ly: number): string {
  return ly < 1 ? `${(ly * 1000).toFixed(0)} mly` : `${ly.toFixed(2)} ly`;
}

function formatEta(hours: number): string {
  if (hours < 1 / 60) return "<1 min";
  if (hours < 1) return `~${Math.ceil(hours * 60)} min`;
  return `~${hours.toFixed(1)} hr`;
}

function spectralName(cls: string): string {
  switch (cls) {
    case "O": return "O-class (blue supergiant)";
    case "B": return "B-class (blue-white)";
    case "A": return "A-class (white)";
    case "F": return "F-class (yellow-white)";
    case "G": return "G-class (yellow dwarf)";
    case "K": return "K-class (orange dwarf)";
    case "M": return "M-class (red dwarf)";
    default:  return `${cls}-class`;
  }
}

/** Color for asteroid nodes by resource type. */
function asteroidColor(resourceType: string): string {
  switch (resourceType) {
    case "iron":         return "#f87171"; // red-400
    case "carbon":       return "#9ca3af"; // gray-400
    case "silica":       return "#67e8f9"; // cyan-300
    case "sulfur":       return "#fde047"; // yellow-300
    case "rare_crystal": return "#c084fc"; // purple-400
    default:             return "#d1d5db"; // gray-300
  }
}

/** Human-readable resource type label. */
function resourceLabel(resourceType: string): string {
  return resourceType.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** SVG polygon points for a diamond centered at (cx, cy) with half-size r. */
function diamondPoints(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

/**
 * Deterministic hue (0–359) derived from an alliance tag string.
 * Different alliances get visually distinct territory colors.
 */
function allianceHue(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (tag.charCodeAt(i) + ((h << 5) - h)) | 0;
  }
  return Math.abs(h) % 360;
}

/** HSL color string for territory fill/stroke from an alliance tag. */
function allianceColor(tag: string): string {
  return `hsl(${allianceHue(tag)}, 65%, 60%)`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GalaxyMapClient({
  systems,
  ships,
  fleets,
  asteroids,
  beacons,
  territories,
  disputes,
  travelLines,
  pixelsPerLy,
  baseRangeLy,
  viewboxW,
  viewboxH,
  stationCoords,
  playerAllianceId,
  canPlaceBeacon,
  playerAllianceBeaconSystemIds: _playerAllianceBeaconSystemIds,
}: GalaxyMapClientProps) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);

  // ── Pan/zoom state ────────────────────────────────────────────────────────
  const [transform, setTransform] = useState({ tx: 0, ty: 0, scale: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  // ── Interaction state ─────────────────────────────────────────────────────
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [travelLoading, setTravelLoading] = useState(false);
  const [travelError, setTravelError] = useState<string | null>(null);

  // ── Asteroid interaction state ─────────────────────────────────────────────
  const [selectedAsteroidId, setSelectedAsteroidId] = useState<string | null>(null);
  const [hoveredAsteroidId, setHoveredAsteroidId] = useState<string | null>(null);
  const [dispatchFleetId, setDispatchFleetId] = useState<string>("");
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [recallLoading, setRecallLoading] = useState(false);

  // ── Per-ship dispatch state ────────────────────────────────────────────────
  const [shipDispatchLoading, setShipDispatchLoading] = useState<string | null>(null);
  const [shipDispatchError, setShipDispatchError] = useState<string | null>(null);

  // ── Multi-ship selection + batch dispatch ──────────────────────────────────
  const [selectedShipIds, setSelectedShipIds] = useState<Set<string>>(new Set());
  const [multiDispatchLoading, setMultiDispatchLoading] = useState(false);

  // ── Animation tick — re-renders at ~30 fps while ships are in transit ────
  // Uses requestAnimationFrame (throttled to 33 ms) so ship position updates
  // smoothly instead of jumping once per second.
  const [, setAnimTick] = useState(0);
  const hasTravelLines = travelLines.length > 0;
  const animRafRef = useRef<number>(0);
  useEffect(() => {
    if (!hasTravelLines) return;
    let lastTime = 0;
    const tick = (time: number) => {
      if (time - lastTime >= 33) { // ~30 fps cap
        lastTime = time;
        setAnimTick((n) => n + 1);
      }
      animRafRef.current = requestAnimationFrame(tick);
    };
    animRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRafRef.current);
  }, [hasTravelLines]);

  // ── Drag-to-dispatch state ─────────────────────────────────────────────────
  interface DragInfo {
    ship: GalaxyShip;
    clientX: number;
    clientY: number;
    targetId: string | null;
  }
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const dragInfoRef = useRef<DragInfo | null>(null);
  dragInfoRef.current = dragInfo; // latest-value pattern: always fresh in callbacks
  const [dragError, setDragError] = useState<string | null>(null);
  const didDragRef = useRef(false); // suppresses click events immediately after a drag ends

  // ── Station drag-to-relocate state ────────────────────────────────────────
  interface StationDragInfo {
    clientX: number;
    clientY: number;
    targetId: string | null;
  }
  const [stationDrag, setStationDrag] = useState<StationDragInfo | null>(null);
  const stationDragRef = useRef<StationDragInfo | null>(null);
  stationDragRef.current = stationDrag;
  const [stationRelocateError, setStationRelocateError] = useState<string | null>(null);
  const [stationRelocateLoading, setStationRelocateLoading] = useState(false);

  // ── Beacon placement state ─────────────────────────────────────────────────
  const [beaconLoading, setBeaconLoading] = useState(false);
  const [beaconError, setBeaconError] = useState<string | null>(null);

  // ── Dispute state ──────────────────────────────────────────────────────────
  const [disputeLoading, setDisputeLoading] = useState<string | null>(null); // beaconId
  const [disputeError, setDisputeError] = useState<string | null>(null);

  // ── Derived data ──────────────────────────────────────────────────────────
  const systemMap = new Map(systems.map((s) => [s.id, s]));
  const asteroidMap = new Map(asteroids.map((a) => [a.id, a]));
  const currentSystem = systems.find((s) => s.isCurrentLocation) ?? null;
  const stationSystem = systems.find((s) => s.isStationLocation) ?? null;
  const dockedShip = ships.find((s) => s.systemId != null) ?? null;
  const selectedSystem = selectedId ? (systemMap.get(selectedId) ?? null) : null;
  const selectedAsteroid = selectedAsteroidId ? (asteroidMap.get(selectedAsteroidId) ?? null) : null;

  // Travel range circle radius in SVG base coords
  const rangeRadius = baseRangeLy * pixelsPerLy;

  // Is selected system reachable?
  const distToSelected = selectedSystem && currentSystem
    ? dist3D(currentSystem, selectedSystem)
    : null;
  const isReachable = distToSelected !== null && distToSelected <= baseRangeLy + 0.01;
  const canTravel =
    isReachable &&
    dockedShip !== null &&
    selectedSystem !== null &&
    !selectedSystem.isCurrentLocation &&
    !selectedSystem.isInTransitTarget;

  // Distance from station to selected system
  const distFromStation = selectedSystem && stationCoords
    ? dist3D(stationCoords, selectedSystem)
    : null;

  // ETA for travel to selected system (hours) for primary docked ship
  const travelEtaHours = distToSelected !== null && dockedShip
    ? distToSelected / dockedShip.speedLyPerHr
    : null;

  // Asteroids in the selected system
  const asteroidCountInSelected = selectedSystem
    ? asteroids.filter((a) => a.systemId === selectedSystem.id).length
    : 0;

  // Beacons grouped by system (for SVG markers)
  const beaconsBySystem = new Map<string, GalaxyBeacon[]>();
  for (const b of beacons) {
    const list = beaconsBySystem.get(b.systemId) ?? [];
    list.push(b);
    beaconsBySystem.set(b.systemId, list);
  }
  // Beacons in the selected system
  const beaconsInSelected = selectedSystem ? (beaconsBySystem.get(selectedSystem.id) ?? []) : [];

  // Territories that contain the selected system
  const territoriesInSelected = selectedSystem
    ? territories.filter((t) => t.systemIds.includes(selectedSystem.id))
    : [];

  // Disputes indexed by beacon system id
  const disputesBySystem = new Map<string, GalaxyDispute[]>();
  for (const d of disputes) {
    const list = disputesBySystem.get(d.beaconSystemId) ?? [];
    list.push(d);
    disputesBySystem.set(d.beaconSystemId, list);
  }
  const disputesInSelected = selectedSystem ? (disputesBySystem.get(selectedSystem.id) ?? []) : [];

  // latest-value refs (avoid stale closures in useCallback handlers)
  const latestTransform = useRef(transform);
  latestTransform.current = transform;
  const systemsRef = useRef(systems);
  systemsRef.current = systems;

  // Ships grouped by system for drag marker positioning
  const shipsBySystem = new Map<string, GalaxyShip[]>();
  for (const ship of ships) {
    if (ship.systemId) {
      const list = shipsBySystem.get(ship.systemId) ?? [];
      list.push(ship);
      shipsBySystem.set(ship.systemId, list);
    }
  }

  // ── SVG coordinate helpers ────────────────────────────────────────────────
  /** Convert client mouse coords to SVG viewBox coords. */
  const clientToSvg = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * viewboxW,
        y: ((clientY - rect.top) / rect.height) * viewboxH,
      };
    },
    [viewboxW, viewboxH],
  );

  // ── Pan handlers ──────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      isPanning.current = true;
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        tx: transform.tx,
        ty: transform.ty,
      };
    },
    [transform.tx, transform.ty],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // ── Drag: ship marker being dragged ──────────────────────────────────
      if (dragInfoRef.current !== null) {
        const current = dragInfoRef.current;
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        // Client → viewbox → base SVG coords
        const vx = ((e.clientX - rect.left) / rect.width) * viewboxW;
        const vy = ((e.clientY - rect.top) / rect.height) * viewboxH;
        const { tx, ty, scale } = latestTransform.current;
        const bx = (vx - tx) / scale;
        const by = (vy - ty) / scale;
        // Find nearest system within hit radius (base SVG units)
        const HIT = 22;
        let nearest: string | null = null;
        let nearestDist = HIT;
        for (const sys of systemsRef.current) {
          const d = Math.sqrt((sys.svgX - bx) ** 2 + (sys.svgY - by) ** 2);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = sys.id;
          }
        }
        // Don't target the ship's own system
        if (nearest === current.ship.systemId) nearest = null;
        const updated: DragInfo = { ...current, clientX: e.clientX, clientY: e.clientY, targetId: nearest };
        setDragInfo(updated);
        dragInfoRef.current = updated;
        return;
      }
      // ── Station drag: relocate station ────────────────────────────────────
      if (stationDragRef.current !== null) {
        const current = stationDragRef.current;
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const vx = ((e.clientX - rect.left) / rect.width) * viewboxW;
        const vy = ((e.clientY - rect.top) / rect.height) * viewboxH;
        const { tx, ty, scale } = latestTransform.current;
        const bx = (vx - tx) / scale;
        const by = (vy - ty) / scale;
        const HIT = 22;
        let nearest: string | null = null;
        let nearestDist = HIT;
        for (const sys of systemsRef.current) {
          const d = Math.sqrt((sys.svgX - bx) ** 2 + (sys.svgY - by) ** 2);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = sys.id;
          }
        }
        // Don't target the current station system
        if (stationSystem && nearest === stationSystem.id) nearest = null;
        const updated: StationDragInfo = { clientX: e.clientX, clientY: e.clientY, targetId: nearest };
        setStationDrag(updated);
        stationDragRef.current = updated;
        return;
      }
      // ── Pan ───────────────────────────────────────────────────────────────
      if (!isPanning.current) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      // dx/dy are in screen pixels; convert to SVG units
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const svgDx = (dx / rect.width) * viewboxW;
      const svgDy = (dy / rect.height) * viewboxH;
      setTransform((prev) => ({
        ...prev,
        tx: panStart.current.tx + svgDx,
        ty: panStart.current.ty + svgDy,
      }));
    },
    [viewboxW, viewboxH],
  );

  function handleMouseLeave() {
    isPanning.current = false;
    if (dragInfoRef.current) {
      setDragInfo(null);
      dragInfoRef.current = null;
    }
    if (stationDragRef.current) {
      setStationDrag(null);
      stationDragRef.current = null;
    }
  }

  async function handleMouseUp() {
    // ── Drag completion ───────────────────────────────────────────────────
    if (dragInfoRef.current !== null) {
      const info = dragInfoRef.current;
      didDragRef.current = true; // suppress the upcoming click event
      setDragInfo(null);
      dragInfoRef.current = null;
      isPanning.current = false;
      if (info.targetId && info.targetId !== info.ship.systemId) {
        setShipDispatchLoading(info.ship.id);
        setDragError(null);
        try {
          const res = await fetch("/api/game/travel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              destinationSystemId: info.targetId,
              shipId: info.ship.id,
            }),
          });
          const json = await res.json();
          if (json.ok) {
            router.refresh();
          } else {
            setDragError(json.error?.message ?? "Dispatch failed.");
          }
        } catch {
          setDragError("Network error.");
        } finally {
          setShipDispatchLoading(null);
        }
      }
      return;
    }
    // ── Station drag completion ───────────────────────────────────────────
    if (stationDragRef.current !== null) {
      const info = stationDragRef.current;
      didDragRef.current = true;
      setStationDrag(null);
      stationDragRef.current = null;
      isPanning.current = false;
      if (info.targetId) {
        setStationRelocateLoading(true);
        setStationRelocateError(null);
        try {
          const res = await fetch("/api/game/station/relocate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ destinationSystemId: info.targetId }),
          });
          const json = await res.json();
          if (json.ok) {
            router.refresh();
          } else {
            setStationRelocateError(json.error?.message ?? "Relocation failed.");
          }
        } catch {
          setStationRelocateError("Network error.");
        } finally {
          setStationRelocateLoading(false);
        }
      }
      return;
    }
    // ── Pan end ───────────────────────────────────────────────────────────
    isPanning.current = false;
  }

  // ── Zoom handler ──────────────────────────────────────────────────────────
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const pt = clientToSvg(e.clientX, e.clientY);
      const delta = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
      setTransform((prev) => {
        const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev.scale * delta));
        const factor = newScale / prev.scale;
        return {
          tx: pt.x - (pt.x - prev.tx) * factor,
          ty: pt.y - (pt.y - prev.ty) * factor,
          scale: newScale,
        };
      });
    },
    [clientToSvg],
  );

  // Attach wheel listener as non-passive to allow preventDefault
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Auto-clear drag dispatch error after 3 s
  useEffect(() => {
    if (!dragError) return;
    const t = setTimeout(() => setDragError(null), 3000);
    return () => clearTimeout(t);
  }, [dragError]);

  // Auto-clear station relocation error after 3 s
  useEffect(() => {
    if (!stationRelocateError) return;
    const t = setTimeout(() => setStationRelocateError(null), 3000);
    return () => clearTimeout(t);
  }, [stationRelocateError]);

  // Auto-clear beacon error after 4 s
  useEffect(() => {
    if (!beaconError) return;
    const t = setTimeout(() => setBeaconError(null), 4000);
    return () => clearTimeout(t);
  }, [beaconError]);

  // Auto-clear dispute error after 4 s
  useEffect(() => {
    if (!disputeError) return;
    const t = setTimeout(() => setDisputeError(null), 4000);
    return () => clearTimeout(t);
  }, [disputeError]);

  // Clear ship multi-selection when the selected system changes
  useEffect(() => {
    setSelectedShipIds(new Set());
  }, [selectedId]);

  // ── Zoom button helpers ───────────────────────────────────────────────────
  function zoomBy(factor: number) {
    setTransform((prev) => {
      const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev.scale * factor));
      const f = newScale / prev.scale;
      const cx = viewboxW / 2;
      const cy = viewboxH / 2;
      return {
        tx: cx - (cx - prev.tx) * f,
        ty: cy - (cy - prev.ty) * f,
        scale: newScale,
      };
    });
  }

  function resetView() {
    setTransform({ tx: 0, ty: 0, scale: 1 });
  }

  // ── Click: select / deselect ──────────────────────────────────────────────
  function toggleShipSelection(shipId: string) {
    setSelectedShipIds((prev) => {
      const next = new Set(prev);
      if (next.has(shipId)) next.delete(shipId);
      else next.add(shipId);
      return next;
    });
  }

  async function handleDispatchSelected(shipIds: string[]) {
    if (!selectedSystem || shipIds.length === 0) return;
    setMultiDispatchLoading(true);
    setShipDispatchError(null);
    const errors: string[] = [];
    await Promise.all(
      shipIds.map(async (shipId) => {
        try {
          const res = await fetch("/api/game/travel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ destinationSystemId: selectedSystem.id, shipId }),
          });
          const json = await res.json();
          if (!json.ok) errors.push(json.error?.message ?? "Dispatch failed.");
        } catch {
          errors.push("Network error.");
        }
      }),
    );
    setMultiDispatchLoading(false);
    if (errors.length > 0) {
      setShipDispatchError(errors[0]);
    } else {
      setSelectedShipIds(new Set());
      router.refresh();
    }
  }

  function handleShipMarkerMouseDown(e: React.MouseEvent, ship: GalaxyShip) {
    e.stopPropagation();
    if (e.button !== 0) return;
    const info: DragInfo = { ship, clientX: e.clientX, clientY: e.clientY, targetId: null };
    setDragInfo(info);
    dragInfoRef.current = info;
  }

  function handleStationMarkerMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    if (e.button !== 0) return;
    const info: StationDragInfo = { clientX: e.clientX, clientY: e.clientY, targetId: null };
    setStationDrag(info);
    stationDragRef.current = info;
  }

  async function handlePlaceBeacon(systemId: string) {
    setBeaconLoading(true);
    setBeaconError(null);
    try {
      const res = await fetch("/api/game/alliance/beacon/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemId }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
      } else {
        setBeaconError(json.error?.message ?? "Failed to place beacon.");
      }
    } catch {
      setBeaconError("Network error.");
    } finally {
      setBeaconLoading(false);
    }
  }

  async function handleRemoveBeacon(beaconId: string) {
    setBeaconLoading(true);
    setBeaconError(null);
    try {
      const res = await fetch("/api/game/alliance/beacon/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beaconId }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
      } else {
        setBeaconError(json.error?.message ?? "Failed to remove beacon.");
      }
    } catch {
      setBeaconError("Network error.");
    } finally {
      setBeaconLoading(false);
    }
  }

  async function handleStartDispute(beaconId: string) {
    setDisputeLoading(beaconId);
    setDisputeError(null);
    try {
      const res = await fetch("/api/game/dispute/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beaconId }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
      } else {
        setDisputeError(json.error?.message ?? "Failed to start dispute.");
      }
    } catch {
      setDisputeError("Network error.");
    } finally {
      setDisputeLoading(null);
    }
  }

  function handleStarClick(e: React.MouseEvent, systemId: string) {
    // Suppress click after a drag ended over this star
    if (didDragRef.current) { didDragRef.current = false; return; }
    e.stopPropagation();
    setSelectedId((prev) => (prev === systemId ? null : systemId));
    setSelectedAsteroidId(null);
    setTravelError(null);
    setDispatchError(null);
    setShipDispatchError(null);
  }

  function handleAsteroidClick(e: React.MouseEvent, asteroidId: string) {
    e.stopPropagation();
    setSelectedAsteroidId((prev) => (prev === asteroidId ? null : asteroidId));
    setSelectedId(null);
    setDispatchError(null);
    setTravelError(null);
  }

  function handleMapClick() {
    // Suppress deselect after a drag ends on the map background
    if (didDragRef.current) { didDragRef.current = false; return; }
    setSelectedId(null);
    setSelectedAsteroidId(null);
    setTravelError(null);
    setDispatchError(null);
    setShipDispatchError(null);
  }

  // ── Travel action ─────────────────────────────────────────────────────────
  async function handleTravel() {
    if (!dockedShip || !selectedSystem) return;
    setTravelLoading(true);
    setTravelError(null);
    try {
      const res = await fetch("/api/game/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationSystemId: selectedSystem.id,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        router.push("/game");
      } else {
        setTravelError(json.error?.message ?? "Travel failed.");
      }
    } catch {
      setTravelError("Network error.");
    } finally {
      setTravelLoading(false);
    }
  }

  // ── Asteroid dispatch / recall ────────────────────────────────────────────
  async function handleDispatch() {
    if (!selectedAsteroid || !dispatchFleetId) return;
    setDispatchLoading(true);
    setDispatchError(null);
    try {
      const res = await fetch("/api/game/asteroid/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asteroidId: selectedAsteroid.id, fleetId: dispatchFleetId }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
      } else {
        setDispatchError(json.error?.message ?? "Dispatch failed.");
      }
    } catch {
      setDispatchError("Network error.");
    } finally {
      setDispatchLoading(false);
    }
  }

  async function handleRecall() {
    if (!selectedAsteroid?.myHarvestId) return;
    setRecallLoading(true);
    setDispatchError(null);
    try {
      const res = await fetch("/api/game/asteroid/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ harvestId: selectedAsteroid.myHarvestId }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
      } else {
        setDispatchError(json.error?.message ?? "Recall failed.");
      }
    } catch {
      setDispatchError("Network error.");
    } finally {
      setRecallLoading(false);
    }
  }

  // ── Per-ship dispatch ─────────────────────────────────────────────────────
  async function handleDispatchShip(shipId: string) {
    if (!selectedSystem) return;
    setShipDispatchLoading(shipId);
    setShipDispatchError(null);
    try {
      const res = await fetch("/api/game/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationSystemId: selectedSystem.id,
          shipId,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
      } else {
        setShipDispatchError(json.error?.message ?? "Dispatch failed.");
      }
    } catch {
      setShipDispatchError("Network error.");
    } finally {
      setShipDispatchLoading(null);
    }
  }

  // ── Label visibility ──────────────────────────────────────────────────────
  /** Show label when: discovered, has colony, is current location, selected, or zoomed in. */
  function showLabel(sys: GalaxySystem): boolean {
    return (
      sys.isDiscovered ||
      sys.colonyCount > 0 ||
      sys.isCurrentLocation ||
      sys.id === selectedId ||
      sys.id === hoveredId ||
      transform.scale >= 2
    );
  }

  // ── Node size ─────────────────────────────────────────────────────────────
  function nodeRadius(sys: GalaxySystem): number {
    const base = sys.isDiscovered ? 7 : 4.5;
    if (sys.isCurrentLocation) return base + 3;
    if (sys.colonyCount > 0) return base + 1.5;
    return base;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const { tx, ty, scale } = transform;
  const groupTransform = `translate(${tx} ${ty}) scale(${scale})`;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── SVG map area ─────────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden bg-[#06060a]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewboxW} ${viewboxH}`}
          className="h-full w-full"
          style={{ cursor: (dragInfo || stationDrag) ? ((dragInfo?.targetId ?? stationDrag?.targetId) ? "copy" : "grabbing") : isPanning.current ? "grabbing" : "grab" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClick={handleMapClick}
        >
          {/* ── Defs: glow filter, markers ──────────────────────────────── */}
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-strong" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Nebula-like background gradient */}
            <radialGradient id="bgGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#1a1a2e" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#06060a" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Background */}
          <rect width={viewboxW} height={viewboxH} fill="#06060a" />
          <ellipse
            cx={viewboxW / 2}
            cy={viewboxH / 2}
            rx={viewboxW * 0.45}
            ry={viewboxH * 0.4}
            fill="url(#bgGlow)"
          />

          {/* ── Main transformable group (pan/zoom) ──────────────────────── */}
          <g transform={groupTransform}>

            {/* ── Alliance territory polygons (rendered first — under everything) ── */}
            {territories.map((t) => {
              if (t.svgPolygon.length < 3) return null;
              const color = allianceColor(t.allianceTag);
              const pts = t.svgPolygon.map((p) => `${p.x},${p.y}`).join(" ");
              return (
                <polygon
                  key={t.allianceId}
                  points={pts}
                  fill={color}
                  fillOpacity={0.08}
                  stroke={color}
                  strokeOpacity={0.30}
                  strokeWidth={1.5 / scale}
                  strokeDasharray={`${5 / scale} ${3 / scale}`}
                  pointerEvents="none"
                />
              );
            })}

            {/* ── Alliance beacon link lines (under system nodes, above territory fill) ── */}
            {territories.flatMap((t) =>
              t.links.map((lnk, i) => {
                const color = allianceColor(t.allianceTag);
                return (
                  <line
                    key={`${t.allianceId}-link-${i}`}
                    x1={lnk.x1}
                    y1={lnk.y1}
                    x2={lnk.x2}
                    y2={lnk.y2}
                    stroke={color}
                    strokeOpacity={0.35}
                    strokeWidth={1 / scale}
                    strokeDasharray={`${4 / scale} ${3 / scale}`}
                    pointerEvents="none"
                  />
                );
              }),
            )}

            {/* ── Travel range circle ─────────────────────────────────────── */}
            {currentSystem && (
              <circle
                cx={currentSystem.svgX}
                cy={currentSystem.svgY}
                r={rangeRadius}
                fill="none"
                stroke="#3f3f5a"
                strokeWidth={1 / scale}
                strokeDasharray={`${6 / scale} ${4 / scale}`}
                pointerEvents="none"
              />
            )}

            {/* ── Travel lines (ship/fleet in-transit paths) ──────────────── */}
            {travelLines.map((tl) => {
              const midX = (tl.x1 + tl.x2) / 2;
              const midY = (tl.y1 + tl.y2) / 2;
              const lineColor  = tl.isFleet ? "#a78bfa" : "#818cf8";
              const labelColor = tl.isFleet ? "#c4b5fd" : "#a5b4fc";

              // Interpolated ship position along the route
              let shipX: number | null = null;
              let shipY: number | null = null;
              let currentT = 0;
              if (tl.departAt && tl.arriveAt) {
                const now = Date.now();
                const depart = new Date(tl.departAt).getTime();
                const arrive = new Date(tl.arriveAt).getTime();
                const total = arrive - depart;
                if (total > 0) {
                  currentT = Math.max(0, Math.min(1, (now - depart) / total));
                  shipX = tl.x1 + (tl.x2 - tl.x1) * currentT;
                  shipY = tl.y1 + (tl.y2 - tl.y1) * currentT;
                }
              }

              // Trail: fixed 7-unit offset behind the ship along the route
              const lineLen = Math.sqrt((tl.x2 - tl.x1) ** 2 + (tl.y2 - tl.y1) ** 2);
              const trailFrac = lineLen > 0 ? 7 / lineLen : 0;
              const trail1T = Math.max(0, currentT - trailFrac * 0.5);
              const trail2T = Math.max(0, currentT - trailFrac);

              // ETA string for midpoint label
              const etaStr = tl.arriveAt
                ? (() => {
                    const msLeft = new Date(tl.arriveAt).getTime() - Date.now();
                    return msLeft > 0 ? ` · ${formatEta(Math.max(0, msLeft / 3600000))}` : " · arriving";
                  })()
                : "";

              // Dim this line if a different system is selected and this line doesn't touch it
              const hasSelection = selectedId !== null;
              const isRelated = !hasSelection || tl.fromSystemId === selectedId || tl.toSystemId === selectedId;
              const lineOpacity = isRelated ? 1 : 0.25;

              return (
                <g key={tl.key} pointerEvents="none" opacity={lineOpacity}>
                  {/* Soft glow underlay — gives the line visual weight on dark bg */}
                  <line
                    x1={tl.x1} y1={tl.y1} x2={tl.x2} y2={tl.y2}
                    stroke={lineColor}
                    strokeWidth={10 / scale}
                    opacity={0.07}
                  />
                  {/* Main dashed line — brighter and slightly thicker than before */}
                  <line
                    x1={tl.x1} y1={tl.y1} x2={tl.x2} y2={tl.y2}
                    stroke={lineColor}
                    strokeWidth={2 / scale}
                    strokeDasharray={`${8 / scale} ${5 / scale}`}
                    opacity={0.80}
                  />
                  {/* Animated flow overlay — faint moving pulses from origin → destination */}
                  <line
                    x1={tl.x1} y1={tl.y1} x2={tl.x2} y2={tl.y2}
                    stroke={lineColor}
                    strokeWidth={2 / scale}
                    strokeDasharray="5 19"
                    opacity={0.40}
                    className="galaxy-travel-flow"
                  />
                  {/* Origin dot — marks departure point */}
                  <circle
                    cx={tl.x1} cy={tl.y1}
                    r={3 / scale}
                    fill={lineColor}
                    opacity={0.55}
                  />
                  {/* Destination: outer ring + solid center */}
                  <circle
                    cx={tl.x2} cy={tl.y2}
                    r={6 / scale}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth={1.5 / scale}
                    opacity={0.75}
                  />
                  <circle
                    cx={tl.x2} cy={tl.y2}
                    r={2.5 / scale}
                    fill={lineColor}
                    opacity={0.95}
                  />
                  {/* Ship trail + marker — trail circles behind, main dot in front */}
                  {shipX !== null && shipY !== null && (
                    <>
                      {/* Trailing glow — furthest back, most transparent */}
                      <circle
                        cx={tl.x1 + (tl.x2 - tl.x1) * trail2T}
                        cy={tl.y1 + (tl.y2 - tl.y1) * trail2T}
                        r={2.5 / scale}
                        fill={labelColor}
                        opacity={0.18}
                        pointerEvents="none"
                      />
                      {/* Trailing glow — mid trail */}
                      <circle
                        cx={tl.x1 + (tl.x2 - tl.x1) * trail1T}
                        cy={tl.y1 + (tl.y2 - tl.y1) * trail1T}
                        r={3.5 / scale}
                        fill={labelColor}
                        opacity={0.35}
                        pointerEvents="none"
                      />
                      {/* Main ship marker */}
                      <circle
                        cx={shipX} cy={shipY}
                        r={4.5 / scale}
                        fill={labelColor}
                        stroke="#06060a"
                        strokeWidth={1.5 / scale}
                        filter="url(#glow)"
                      />
                      {/* Outer motion-glow ring */}
                      <circle
                        cx={shipX} cy={shipY}
                        r={7.5 / scale}
                        fill="none"
                        stroke={labelColor}
                        strokeWidth={0.8 / scale}
                        opacity={0.22}
                        pointerEvents="none"
                      />
                    </>
                  )}
                  {/* Arrival proximity pulse — activates when ship is >92% of the way */}
                  {currentT > 0.92 && (
                    <circle
                      cx={tl.x2} cy={tl.y2}
                      r={11 / scale}
                      fill="none"
                      stroke={lineColor}
                      strokeWidth={1.5 / scale}
                      className="galaxy-arrival-ring"
                      pointerEvents="none"
                    />
                  )}
                  {/* Label: ship name + ETA — visible at moderate zoom */}
                  {scale >= 0.8 && (
                    <text
                      x={midX}
                      y={midY - 8 / scale}
                      fill={labelColor}
                      fontSize={9 / scale < 7 ? 7 : 9 / scale > 11 ? 11 : 9 / scale}
                      textAnchor="middle"
                      opacity={0.90}
                    >
                      {tl.label}{etaStr}
                    </text>
                  )}
                </g>
              );
            })}

            {/* ── System stars ──────────────────────────────────────────────── */}
            {systems.map((sys) => {
              const r = nodeRadius(sys);
              const color = spectralColor(sys.spectralClass);
              const isHovered   = sys.id === hoveredId;
              const isSelected  = sys.id === selectedId;
              const isCurrent   = sys.isCurrentLocation;
              const isDim       = !sys.isDiscovered && !sys.hasDockedShip;
              const opacity     = isDim ? 0.35 : 1;

              return (
                <g
                  key={sys.id}
                  className="cursor-pointer"
                  onClick={(e) => handleStarClick(e, sys.id)}
                  onMouseEnter={() => setHoveredId(sys.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Selection ring */}
                  {isSelected && (
                    <circle
                      cx={sys.svgX}
                      cy={sys.svgY}
                      r={(r + 7) / scale > r + 7 ? r + 7 : r + 7}
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth={1.5 / scale}
                    />
                  )}

                  {/* Current location pulse ring */}
                  {isCurrent && (
                    <circle
                      cx={sys.svgX}
                      cy={sys.svgY}
                      r={r + 12}
                      fill="none"
                      stroke="#34d399"
                      strokeWidth={1 / scale}
                      opacity={0.4}
                    />
                  )}

                  {/* Hover hover ring */}
                  {isHovered && !isSelected && (
                    <circle
                      cx={sys.svgX}
                      cy={sys.svgY}
                      r={r + 5}
                      fill="none"
                      stroke={color}
                      strokeWidth={1 / scale}
                      opacity={0.4}
                    />
                  )}

                  {/* Drag-target highlight ring — ship drag or station relocation */}
                  {(dragInfo?.targetId === sys.id || stationDrag?.targetId === sys.id) && (
                    <circle
                      cx={sys.svgX}
                      cy={sys.svgY}
                      r={r + 10}
                      fill="none"
                      stroke={stationDrag?.targetId === sys.id ? "#fbbf24" : "#a5b4fc"}
                      strokeWidth={2 / scale}
                      opacity={0.9}
                      filter="url(#glow)"
                    />
                  )}

                  {/* Station aura — breathing fill glow marks the player hub */}
                  {sys.isStationLocation && (
                    <>
                      <circle
                        cx={sys.svgX}
                        cy={sys.svgY}
                        r={r * 3.5}
                        fill={color}
                        className="galaxy-station-aura"
                        pointerEvents="none"
                      />
                      <circle
                        cx={sys.svgX}
                        cy={sys.svgY}
                        r={r + 9}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth={1 / scale}
                        opacity={0.30}
                        pointerEvents="none"
                      />
                    </>
                  )}

                  {/* Colony breathing ring — subtle pulse to show active colony */}
                  {sys.colonyCount > 0 && !isCurrent && (
                    <circle
                      cx={sys.svgX}
                      cy={sys.svgY}
                      r={r + 5}
                      fill="none"
                      stroke="#34d399"
                      strokeWidth={0.8 / scale}
                      className="galaxy-colony-pulse"
                      pointerEvents="none"
                    />
                  )}

                  {/* Star glow (discovered/important only) */}
                  {(sys.isDiscovered || sys.colonyCount > 0) && (
                    <circle
                      cx={sys.svgX}
                      cy={sys.svgY}
                      r={r * 2}
                      fill={color}
                      opacity={sys.isStationLocation ? 0.14 : 0.08}
                      pointerEvents="none"
                    />
                  )}

                  {/* Main star body */}
                  <circle
                    cx={sys.svgX}
                    cy={sys.svgY}
                    r={r}
                    fill={isDim ? "#374151" : isCurrent ? "#34d399" : color}
                    opacity={opacity}
                    filter={
                      isCurrent || isSelected || sys.isStationLocation
                        ? "url(#glow)"
                        : undefined
                    }
                  />

                  {/* Colony dot (top-right of star) */}
                  {sys.colonyCount > 0 && (
                    <circle
                      cx={sys.svgX + r * 0.7}
                      cy={sys.svgY - r * 0.7}
                      r={3}
                      fill="#34d399"
                      opacity={0.9}
                    />
                  )}

                  {/* Fleet indicator (bottom-right) */}
                  {sys.hasDockedFleet && (
                    <circle
                      cx={sys.svgX + r * 0.7}
                      cy={sys.svgY + r * 0.7}
                      r={2.5}
                      fill="#a78bfa"
                      opacity={0.9}
                    />
                  )}

                  {/* Transit origin marker — ship departed from here */}
                  {sys.isTransitOrigin && !sys.isCurrentLocation && (
                    <circle
                      cx={sys.svgX}
                      cy={sys.svgY}
                      r={r + 7}
                      fill="none"
                      stroke="#6366f1"
                      strokeWidth={1 / scale}
                      opacity={0.35}
                    />
                  )}
                  {/* In-transit destination marker — ship is heading here */}
                  {sys.isInTransitTarget && (
                    <circle
                      cx={sys.svgX}
                      cy={sys.svgY}
                      r={r + 5}
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth={1.5 / scale}
                      strokeDasharray={`${4 / scale} ${3 / scale}`}
                      opacity={0.80}
                    />
                  )}

                  {/* Steward crown mark (small ring, player-owned) */}
                  {sys.isPlayerSteward && (
                    <circle
                      cx={sys.svgX - r * 0.7}
                      cy={sys.svgY - r * 0.7}
                      r={2.5}
                      fill="#fbbf24"
                      opacity={0.9}
                    />
                  )}

                  {/* System label */}
                  {showLabel(sys) && (
                    <text
                      x={sys.svgX}
                      y={sys.svgY + r + 11}
                      textAnchor="middle"
                      fontSize={10 / scale < 8 ? 8 : 10 / scale > 13 ? 13 : 10 / scale}
                      fill={
                        isCurrent
                          ? "#34d399"
                          : isSelected
                            ? "#a5b4fc"
                            : sys.isDiscovered
                              ? "#d1d5db"
                              : "#6b7280"
                      }
                      className="select-none pointer-events-none"
                    >
                      {sys.name}
                    </text>
                  )}
                </g>
              );
            })}

            {/* ── Asteroid nodes ──────────────────────────────────────────────── */}
            {asteroids.map((ast) => {
              const color = asteroidColor(ast.resourceType);
              const isHovered  = ast.id === hoveredAsteroidId;
              const isSelected = ast.id === selectedAsteroidId;
              const isMine     = ast.myHarvestId !== null;
              // Depletion fraction dims the node as it runs out
              const fraction   = ast.totalAmount > 0 ? ast.remainingAmount / ast.totalAmount : 0;
              const opacity    = 0.5 + fraction * 0.5; // 50%–100%
              const r = 5;

              return (
                <g
                  key={ast.id}
                  className="cursor-pointer"
                  onClick={(e) => handleAsteroidClick(e, ast.id)}
                  onMouseEnter={() => setHoveredAsteroidId(ast.id)}
                  onMouseLeave={() => setHoveredAsteroidId(null)}
                  opacity={opacity}
                >
                  {/* Selection ring */}
                  {isSelected && (
                    <polygon
                      points={diamondPoints(ast.svgX, ast.svgY, r + 7)}
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth={1.5 / scale}
                    />
                  )}

                  {/* Hover ring */}
                  {isHovered && !isSelected && (
                    <polygon
                      points={diamondPoints(ast.svgX, ast.svgY, r + 5)}
                      fill="none"
                      stroke={color}
                      strokeWidth={1 / scale}
                      opacity={0.5}
                    />
                  )}

                  {/* "My fleet is harvesting" pulse ring */}
                  {isMine && (
                    <polygon
                      points={diamondPoints(ast.svgX, ast.svgY, r + 9)}
                      fill="none"
                      stroke={color}
                      strokeWidth={1 / scale}
                      strokeDasharray={`${3 / scale} ${3 / scale}`}
                      opacity={0.4}
                    />
                  )}

                  {/* Diamond body */}
                  <polygon
                    points={diamondPoints(ast.svgX, ast.svgY, r)}
                    fill={color}
                    stroke="#06060a"
                    strokeWidth={0.8 / scale}
                  />

                  {/* Label at high zoom or when selected/hovered */}
                  {(isSelected || isHovered || transform.scale >= 3) && (
                    <text
                      x={ast.svgX}
                      y={ast.svgY + r + 9}
                      textAnchor="middle"
                      fontSize={9 / scale < 7 ? 7 : 9 / scale > 11 ? 11 : 9 / scale}
                      fill={color}
                      opacity={0.8}
                      className="select-none pointer-events-none"
                    >
                      {resourceLabel(ast.resourceType)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* ── Docked ship markers (draggable) ─────────────────────────── */}
            {ships.filter((s) => s.systemId !== null).map((ship) => {
              const sys = systemMap.get(ship.systemId!);
              if (!sys) return null;
              const shipsAtSys = shipsBySystem.get(ship.systemId!) ?? [];
              const idx = shipsAtSys.indexOf(ship);
              const count = shipsAtSys.length;
              const starR = nodeRadius(sys);
              // Spread horizontally above the star
              const mx = sys.svgX + (idx - (count - 1) / 2) * 11;
              const my = sys.svgY - starR - 14;
              const isDraggingThis = dragInfo?.ship.id === ship.id;
              return (
                <g
                  key={`shipmarker-${ship.id}`}
                  style={{ cursor: "grab" }}
                  onMouseDown={(e) => handleShipMarkerMouseDown(e, ship)}
                >
                  {/* Outer ring */}
                  <circle
                    cx={mx} cy={my}
                    r={6 / scale}
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth={1.5 / scale}
                    opacity={isDraggingThis ? 0.25 : 0.65}
                  />
                  {/* Inner dot */}
                  <circle
                    cx={mx} cy={my}
                    r={3.5 / scale}
                    fill={isDraggingThis ? "#a5b4fc" : "#818cf8"}
                    stroke="#06060a"
                    strokeWidth={0.8 / scale}
                    filter="url(#glow)"
                    opacity={isDraggingThis ? 0.4 : 1}
                  />
                </g>
              );
            })}

            {/* ── Station marker (draggable to relocate) ──────────────────── */}
            {stationSystem && (() => {
              const sys = stationSystem;
              const starR = nodeRadius(sys);
              // Position station marker below-right of the star (avoids ship marker area)
              const mx = sys.svgX + starR + 10;
              const my = sys.svgY + starR + 10;
              const isDragging = stationDrag !== null;
              return (
                <g
                  key="station-marker"
                  style={{ cursor: stationRelocateLoading ? "wait" : "grab" }}
                  onMouseDown={handleStationMarkerMouseDown}
                >
                  {/* Outer amber ring */}
                  <circle
                    cx={mx} cy={my}
                    r={7 / scale}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={1.5 / scale}
                    opacity={isDragging ? 0.25 : 0.80}
                  />
                  {/* Inner amber dot */}
                  <circle
                    cx={mx} cy={my}
                    r={4 / scale}
                    fill={isDragging ? "#fcd34d" : "#f59e0b"}
                    stroke="#06060a"
                    strokeWidth={0.8 / scale}
                    filter="url(#glow)"
                    opacity={isDragging ? 0.35 : 1}
                  />
                  {/* "S" label at higher zoom */}
                  {scale >= 1.5 && (
                    <text
                      x={mx}
                      y={my + 3.5 / scale}
                      textAnchor="middle"
                      fontSize={5 / scale < 4 ? 4 : 5 / scale > 7 ? 7 : 5 / scale}
                      fill="#06060a"
                      fontWeight="bold"
                      className="select-none pointer-events-none"
                    >
                      S
                    </text>
                  )}
                </g>
              );
            })()}

            {/* ── Alliance beacons ─────────────────────────────────────────── */}
            {systems.map((sys) => {
              const sysBeacons = beaconsBySystem.get(sys.id);
              if (!sysBeacons || sysBeacons.length === 0) return null;
              const r = sys.spectralClass === "O" || sys.spectralClass === "B" ? 8
                : sys.spectralClass === "G" || sys.spectralClass === "K" ? 7
                : 6;
              // Show a small flag/diamond in top-left, one per alliance (stacked)
              return sysBeacons.map((b, i) => (
                <g key={b.id} pointerEvents="none">
                  <rect
                    x={sys.svgX - r - 9 - i * 5}
                    y={sys.svgY - r - 9}
                    width={7}
                    height={7}
                    rx={1}
                    fill="#6366f1"
                    opacity={0.85}
                  />
                  {(transform.scale >= 2.5 || i === 0) && (
                    <text
                      x={sys.svgX - r - 5 - i * 5}
                      y={sys.svgY - r - 12}
                      textAnchor="middle"
                      fontSize={8 / scale < 6 ? 6 : 8 / scale > 10 ? 10 : 8 / scale}
                      fill="#818cf8"
                      opacity={0.9}
                      className="select-none"
                    >
                      {b.allianceTag}
                    </text>
                  )}
                </g>
              ));
            })}

            {/* ── Active dispute markers ───────────────────────────────────── */}
            {systems.map((sys) => {
              const sysDisputes = disputesBySystem.get(sys.id);
              if (!sysDisputes || sysDisputes.length === 0) return null;
              const r = sys.spectralClass === "O" || sys.spectralClass === "B" ? 8
                : sys.spectralClass === "G" || sys.spectralClass === "K" ? 7
                : 6;
              return (
                <g key={`dispute-${sys.id}`} pointerEvents="none">
                  {/* Pulsing orange ring around disputed systems */}
                  <circle
                    cx={sys.svgX}
                    cy={sys.svgY}
                    r={r + 10}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth={1.5 / scale}
                    strokeDasharray={`${4 / scale} ${3 / scale}`}
                    opacity={0.7}
                  />
                  {/* Exclamation badge */}
                  <circle
                    cx={sys.svgX + r + 4}
                    cy={sys.svgY + r + 4}
                    r={4}
                    fill="#f97316"
                    opacity={0.9}
                  />
                  <text
                    x={sys.svgX + r + 4}
                    y={sys.svgY + r + 7.5}
                    textAnchor="middle"
                    fontSize={6}
                    fill="#1c0a00"
                    fontWeight="bold"
                    className="select-none"
                  >
                    !
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* ── Drag ghost overlay ───────────────────────────────────────── */}
        {dragInfo && (
          <div
            className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded border border-indigo-700 bg-indigo-950/95 px-2 py-1 text-xs text-indigo-200 shadow-lg"
            style={{ left: dragInfo.clientX + 14, top: dragInfo.clientY - 14 }}
          >
            <span>{dragInfo.ship.name}</span>
            {dragInfo.targetId ? (
              <span className="text-indigo-400">
                → {systemMap.get(dragInfo.targetId)?.name ?? dragInfo.targetId}
              </span>
            ) : (
              <span className="text-indigo-700">drag to system</span>
            )}
          </div>
        )}

        {/* ── Station drag ghost overlay ────────────────────────────────── */}
        {stationDrag && (
          <div
            className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded border border-amber-700 bg-amber-950/95 px-2 py-1 text-xs text-amber-200 shadow-lg"
            style={{ left: stationDrag.clientX + 14, top: stationDrag.clientY - 14 }}
          >
            <span>Station</span>
            {stationDrag.targetId ? (
              <span className="text-amber-400">
                → {systemMap.get(stationDrag.targetId)?.name ?? stationDrag.targetId}
              </span>
            ) : (
              <span className="text-amber-800">drag to system</span>
            )}
          </div>
        )}

        {/* ── Drag dispatch error ───────────────────────────────────────── */}
        {(dragError || stationRelocateError) && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded border border-red-800 bg-red-950/90 px-3 py-1.5 text-xs text-red-300 shadow-lg">
            {dragError ?? stationRelocateError}
          </div>
        )}

        {/* ── Floating controls (bottom-left) ─────────────────────────────── */}
        <div className="absolute bottom-4 left-4 flex flex-col gap-1.5">
          <button
            onClick={() => zoomBy(1.25)}
            className="flex h-7 w-7 items-center justify-center rounded border border-zinc-700 bg-zinc-900/80 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => zoomBy(0.8)}
            className="flex h-7 w-7 items-center justify-center rounded border border-zinc-700 bg-zinc-900/80 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            title="Zoom out"
          >
            −
          </button>
          <button
            onClick={resetView}
            className="flex h-7 w-7 items-center justify-center rounded border border-zinc-700 bg-zinc-900/80 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            title="Reset view"
          >
            ⊙
          </button>
        </div>

        {/* ── Map legend (bottom-right) ─────────────────────────────────── */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1 rounded border border-zinc-800 bg-zinc-900/80 px-2.5 py-2 text-xs text-zinc-600 backdrop-blur-sm">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 opacity-80" />
            Current location
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Colony
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-violet-400" />
            Fleet
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            Steward
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full border border-amber-500/70 bg-amber-500/30" />
            Station (drag to move)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rotate-45 bg-yellow-300/70" />
            Asteroid
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-indigo-500/80" />
            Beacon
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm border border-dashed border-indigo-400/50 bg-indigo-500/10" />
            Territory
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full border border-dashed border-orange-500/70" />
            Disputed
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-zinc-700">
            <span className="inline-block h-px w-4 border-t border-dashed border-zinc-700" />
            Travel range
          </span>
        </div>

        {/* ── Hover tooltip (floating) ──────────────────────────────────── */}
        {hoveredId && hoveredId !== selectedId && (
          (() => {
            const s = systemMap.get(hoveredId);
            if (!s) return null;
            return (
              <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded border border-zinc-700 bg-zinc-900/95 px-3 py-1.5 text-xs shadow-lg">
                <span className="font-medium text-zinc-200">{s.name}</span>
                <span className="ml-2 text-zinc-500">{s.spectralClass}-class</span>
                <span className="ml-2 text-zinc-600">{formatDist(s.distanceFromSol)} from Sol</span>
                {s.isDiscovered && <span className="ml-2 text-emerald-600">discovered</span>}
                {s.colonyCount > 0 && (
                  <span className="ml-2 text-emerald-500">
                    {s.colonyCount} {s.colonyCount === 1 ? "colony" : "colonies"}
                  </span>
                )}
              </div>
            );
          })()
        )}
        {hoveredAsteroidId && hoveredAsteroidId !== selectedAsteroidId && (
          (() => {
            const a = asteroidMap.get(hoveredAsteroidId);
            if (!a) return null;
            const pct = a.totalAmount > 0 ? Math.round((a.remainingAmount / a.totalAmount) * 100) : 0;
            return (
              <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded border border-zinc-700 bg-zinc-900/95 px-3 py-1.5 text-xs shadow-lg">
                <span className="font-medium" style={{ color: asteroidColor(a.resourceType) }}>
                  {resourceLabel(a.resourceType)}
                </span>
                <span className="ml-2 text-zinc-500">Asteroid</span>
                <span className="ml-2 text-zinc-400">{a.remainingAmount} / {a.totalAmount} u</span>
                <span className="ml-2 text-zinc-600">{pct}% remaining</span>
                {a.myHarvestId && <span className="ml-2 text-yellow-400">Harvesting</span>}
              </div>
            );
          })()
        )}
      </div>

      {/* ── Right panel: selected system or asteroid ──────────────────────── */}
      <div className="flex w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
        {selectedAsteroid ? (
          (() => {
            const a = selectedAsteroid;
            const color = asteroidColor(a.resourceType);
            const pct = a.totalAmount > 0 ? Math.round((a.remainingAmount / a.totalAmount) * 100) : 0;
            // Fleets in this asteroid's system that are NOT already harvesting
            const eligibleFleets = fleets.filter(
              (f) => f.systemId === a.systemId && !f.isHarvesting,
            );
            return (
              <>
                {/* Header */}
                <div className="border-b border-zinc-800 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rotate-45 shrink-0" style={{ background: color }} />
                    <h2 className="text-sm font-semibold text-zinc-200 truncate">
                      {resourceLabel(a.resourceType)} Asteroid
                    </h2>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    Near {a.systemId} system
                  </p>
                </div>

                {/* Stats */}
                <div className="divide-y divide-zinc-800/50 px-4 py-1">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-xs text-zinc-600">Resource</span>
                    <span className="text-xs font-medium" style={{ color }}>
                      {resourceLabel(a.resourceType)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-xs text-zinc-600">Remaining</span>
                    <span className="text-xs text-zinc-300">
                      {a.remainingAmount} / {a.totalAmount} u ({pct}%)
                    </span>
                  </div>
                  {/* Depletion bar */}
                  <div className="py-2">
                    <div className="h-1.5 w-full rounded-full bg-zinc-800">
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                  </div>
                  {a.myHarvestId && (
                    <div className="flex items-center justify-between py-2">
                      <span className="text-xs text-zinc-600">Your fleet</span>
                      <span className="text-xs text-yellow-400">Harvesting</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-auto border-t border-zinc-800 p-4 space-y-2">
                  {dispatchError && (
                    <p className="text-xs text-red-400">{dispatchError}</p>
                  )}

                  {/* Recall own fleet */}
                  {a.myHarvestId && (
                    <button
                      onClick={handleRecall}
                      disabled={recallLoading}
                      className="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors disabled:opacity-50"
                    >
                      {recallLoading ? "Recalling…" : "Recall Fleet"}
                    </button>
                  )}

                  {/* Dispatch a fleet */}
                  {!a.myHarvestId && eligibleFleets.length > 0 && (
                    <div className="space-y-1.5">
                      <select
                        value={dispatchFleetId}
                        onChange={(e) => setDispatchFleetId(e.target.value)}
                        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 focus:border-zinc-500 focus:outline-none"
                      >
                        <option value="">Select fleet…</option>
                        {eligibleFleets.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleDispatch}
                        disabled={dispatchLoading || !dispatchFleetId}
                        className="w-full rounded border border-yellow-700 bg-yellow-950/60 px-3 py-2 text-xs font-medium text-yellow-300 hover:bg-yellow-900/60 hover:text-yellow-200 transition-colors disabled:opacity-50"
                      >
                        {dispatchLoading ? "Dispatching…" : "Dispatch Fleet"}
                      </button>
                    </div>
                  )}

                  {/* No eligible fleets */}
                  {!a.myHarvestId && eligibleFleets.length === 0 && (
                    <p className="text-xs text-zinc-700 text-center">
                      No fleets available in {a.systemId}.
                      <br />
                      Travel a fleet here first.
                    </p>
                  )}
                </div>
              </>
            );
          })()
        ) : selectedSystem ? (
          <>
            {/* Header */}
            <div className="border-b border-zinc-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ background: spectralColor(selectedSystem.spectralClass) }}
                />
                <h2 className="text-sm font-semibold text-zinc-200 truncate">
                  {selectedSystem.name}
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                {spectralName(selectedSystem.spectralClass)}
              </p>
              <p className="mt-0.5 text-xs text-zinc-700">
                {formatDist(selectedSystem.distanceFromSol)} from Sol
              </p>
            </div>

            {/* Stats */}
            <div className="divide-y divide-zinc-800/50 px-4 py-1 overflow-y-auto">

              {/* Bodies */}
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-zinc-600">Bodies</span>
                <span className="text-xs text-zinc-400">{selectedSystem.bodyCount}</span>
              </div>

              {/* Discovery / steward */}
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-zinc-600">Status</span>
                <span className={`text-xs ${selectedSystem.isDiscovered ? "text-emerald-400" : "text-zinc-600"}`}>
                  {selectedSystem.isDiscovered
                    ? selectedSystem.isPlayerSteward
                      ? "Steward ★"
                      : selectedSystem.discovererHandle
                        ? `Discovered · ${selectedSystem.discovererHandle}`
                        : "Discovered"
                    : "Unexplored"}
                </span>
              </div>

              {/* Station anchor */}
              {selectedSystem.isStationLocation && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">Station</span>
                  <span className="text-xs text-amber-400">Your hub</span>
                </div>
              )}

              {/* Distance from station */}
              {distFromStation !== null && !selectedSystem.isStationLocation && stationSystem && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">From station</span>
                  <span className="text-xs text-zinc-500">{formatDist(distFromStation)}</span>
                </div>
              )}

              {/* Distance from current ship / ETA */}
              {currentSystem && !selectedSystem.isCurrentLocation && distToSelected !== null && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">From ship</span>
                  <span className={`text-xs ${isReachable ? "text-zinc-300" : "text-zinc-600"}`}>
                    {formatDist(distToSelected)}
                    {isReachable && travelEtaHours !== null
                      ? ` · ${formatEta(travelEtaHours)}`
                      : isReachable
                        ? ""
                        : " — out of range"}
                  </span>
                </div>
              )}

              {/* Current location badge */}
              {selectedSystem.isCurrentLocation && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">Ship</span>
                  <span className="text-xs text-emerald-400">Docked here</span>
                </div>
              )}

              {/* In transit */}
              {selectedSystem.isInTransitTarget && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">Transit</span>
                  <span className="text-xs text-indigo-400">Ship en route</span>
                </div>
              )}

              {/* Colonies */}
              {selectedSystem.colonyCount > 0 && (
                <div className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-600">Your colonies</span>
                    <span className="text-xs text-emerald-300">{selectedSystem.colonyCount}</span>
                  </div>
                  {/* Ships whose pinned colony is in this system */}
                  {(() => {
                    const assignedHere = ships.filter(
                      (s) => s.pinnedColonySystemId === selectedSystem.id,
                    );
                    if (assignedHere.length === 0) return null;
                    return (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {assignedHere.map((s) => (
                          <span
                            key={s.id}
                            className="rounded border border-indigo-900/50 bg-indigo-950/40 px-1.5 py-0.5 text-xs text-indigo-400"
                            title={`${s.name} is pinned to a colony here`}
                          >
                            {s.name}
                          </span>
                        ))}
                        <span className="text-xs text-indigo-700 self-center">assigned</span>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Fleet present */}
              {selectedSystem.hasDockedFleet && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">Fleet</span>
                  <span className="text-xs text-violet-400">Present</span>
                </div>
              )}

              {/* Asteroid activity */}
              {asteroidCountInSelected > 0 && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">Asteroids</span>
                  <span className="text-xs text-yellow-400">
                    {asteroidCountInSelected} active
                  </span>
                </div>
              )}

              {/* Alliance beacons */}
              {(beaconsInSelected.length > 0 || canPlaceBeacon) && (
                <div className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-600">Beacons</span>
                    {beaconsInSelected.length > 0 && (
                      <span className="text-xs text-indigo-400">
                        {beaconsInSelected.length} alliance{beaconsInSelected.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {beaconsInSelected.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {beaconsInSelected.map((b) => (
                        <span
                          key={b.id}
                          title={b.allianceName}
                          className="font-mono text-xs text-indigo-300 bg-indigo-950/60 border border-indigo-800/50 px-1.5 py-0.5 rounded"
                        >
                          [{b.allianceTag}]
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Place / Remove beacon actions */}
                  {canPlaceBeacon && selectedSystem && (() => {
                    const myBeacon = playerAllianceId
                      ? beaconsInSelected.find((b) => b.allianceId === playerAllianceId)
                      : undefined;
                    if (myBeacon) {
                      return (
                        <button
                          onClick={() => handleRemoveBeacon(myBeacon.id)}
                          disabled={beaconLoading}
                          className="mt-2 w-full text-xs rounded border border-red-800/60 bg-red-950/40 px-2 py-1.5 text-red-400 hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-wait transition-colors"
                        >
                          {beaconLoading ? "Removing…" : "Remove Beacon"}
                        </button>
                      );
                    }
                    return (
                      <button
                        onClick={() => handlePlaceBeacon(selectedSystem.id)}
                        disabled={beaconLoading}
                        className="mt-2 w-full text-xs rounded border border-indigo-700/60 bg-indigo-950/40 px-2 py-1.5 text-indigo-300 hover:bg-indigo-900/50 disabled:opacity-50 disabled:cursor-wait transition-colors"
                      >
                        {beaconLoading ? "Placing…" : "Place Beacon (50 iron)"}
                      </button>
                    );
                  })()}
                  {beaconError && (
                    <p className="mt-1 text-xs text-red-400">{beaconError}</p>
                  )}
                  {/* Challenge (Start Dispute) buttons for foreign beacons */}
                  {canPlaceBeacon && playerAllianceId && (() => {
                    const disputedBeaconIds = new Set(disputes.map((d) => d.beaconId));
                    const foreignBeacons = beaconsInSelected.filter(
                      (b) => b.allianceId !== playerAllianceId && !disputedBeaconIds.has(b.id),
                    );
                    if (foreignBeacons.length === 0) return null;
                    return (
                      <div className="mt-2 space-y-1">
                        {foreignBeacons.map((b) => (
                          <button
                            key={b.id}
                            onClick={() => handleStartDispute(b.id)}
                            disabled={disputeLoading === b.id}
                            className="w-full text-xs rounded border border-orange-800/60 bg-orange-950/30 px-2 py-1.5 text-orange-400 hover:bg-orange-900/40 disabled:opacity-50 disabled:cursor-wait transition-colors"
                          >
                            {disputeLoading === b.id
                              ? "Challenging…"
                              : `Challenge [{${b.allianceTag}}] Beacon`}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  {disputeError && (
                    <p className="mt-1 text-xs text-red-400">{disputeError}</p>
                  )}
                </div>
              )}

              {/* Active disputes */}
              {disputesInSelected.length > 0 && (
                <div className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-600">Disputes</span>
                    <span className="text-xs text-orange-400">
                      {disputesInSelected.length} active
                    </span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {disputesInSelected.map((d) => {
                      const now = Date.now();
                      const msleft = new Date(d.resolvesAt).getTime() - now;
                      const hleft = Math.max(0, msleft / (1000 * 60 * 60));
                      const timeStr = hleft < 1
                        ? `${Math.ceil(hleft * 60)} min`
                        : `${hleft.toFixed(1)} hr`;
                      return (
                        <div key={d.id} className="rounded border border-orange-900/50 bg-orange-950/30 px-2 py-1.5 text-xs">
                          <div className="flex items-center gap-1 text-orange-300">
                            <span className="font-mono">[{d.defendingAllianceTag}]</span>
                            <span className="text-orange-600">vs</span>
                            <span className="font-mono">[{d.attackingAllianceTag}]</span>
                          </div>
                          <div className="mt-0.5 text-orange-600">Resolves in ~{timeStr}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Alliance territory */}
              {territoriesInSelected.length > 0 && (
                <div className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-600">Territory</span>
                    <span className="text-xs" style={{ color: allianceColor(territoriesInSelected[0].allianceTag) }}>
                      {territoriesInSelected.length === 1
                        ? territoriesInSelected[0].allianceName
                        : `${territoriesInSelected.length} alliances`}
                    </span>
                  </div>
                  {territoriesInSelected.length > 1 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {territoriesInSelected.map((t) => (
                        <span
                          key={t.allianceId}
                          title={t.allianceName}
                          className="font-mono text-xs px-1.5 py-0.5 rounded border"
                          style={{
                            color: allianceColor(t.allianceTag),
                            borderColor: allianceColor(t.allianceTag) + "40",
                            background: allianceColor(t.allianceTag) + "15",
                          }}
                        >
                          [{t.allianceTag}]
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Ship dispatch ─────────────────────────────────────── */}
              {ships.length > 0 && (() => {
                // Categorise ships relative to the selected system
                const shipsHere = ships.filter((s) => s.systemId === selectedSystem.id);
                const shipsInTransit = ships.filter((s) => s.systemId === null);

                // Ships docked elsewhere — compute range + ETA
                type Candidate = { ship: GalaxyShip; sys: GalaxySystem; distLy: number; etaHr: number; inRange: boolean };
                const candidates: Candidate[] = ships
                  .filter((s) => s.systemId !== null && s.systemId !== selectedSystem.id)
                  .flatMap((ship) => {
                    const sys = systemMap.get(ship.systemId!);
                    if (!sys) return [];
                    const distLy = dist3D(sys, selectedSystem);
                    const inRange = distLy <= baseRangeLy + 0.01;
                    return [{ ship, sys, distLy, etaHr: distLy / ship.speedLyPerHr, inRange }];
                  });
                const inRange = candidates.filter((c) => c.inRange);
                const outOfRange = candidates.filter((c) => !c.inRange);

                // Multi-select helpers
                const selectedInRange = inRange.filter((c) => selectedShipIds.has(c.ship.id));
                const allInRangeSelected = inRange.length > 0 && inRange.every((c) => selectedShipIds.has(c.ship.id));

                return (
                  <div className="py-2">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-600">
                      Ships
                    </p>
                    {shipDispatchError && (
                      <p className="mb-2 text-xs text-red-400">{shipDispatchError}</p>
                    )}

                    {/* Ships already docked here */}
                    {shipsHere.length > 0 && (
                      <div className="mb-3">
                        <p className="mb-1.5 text-xs text-zinc-700">
                          {selectedSystem.isStationLocation ? "At station" : "In system"}
                        </p>
                        <div className="space-y-1">
                          {shipsHere.map((ship) => {
                            const pinnedSysName = ship.pinnedColonySystemId
                              ? (systemMap.get(ship.pinnedColonySystemId)?.name ?? ship.pinnedColonySystemId)
                              : null;
                            return (
                              <div
                                key={ship.id}
                                className="rounded border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1.5"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 opacity-70" />
                                  <p className="flex-1 truncate text-xs text-zinc-300">{ship.name}</p>
                                  {ship.dispatchMode !== "manual" && (
                                    <span className="shrink-0 rounded border border-teal-900/50 bg-teal-950/40 px-1 py-0.5 text-xs text-teal-600">
                                      Auto
                                    </span>
                                  )}
                                </div>
                                {pinnedSysName && (
                                  <p className="mt-0.5 pl-3.5 text-xs text-indigo-500/80">
                                    Pinned → {pinnedSysName}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Eligible ships to dispatch here */}
                    {inRange.length > 0 && (
                      <div className="mb-3">
                        {/* Section header with select-all toggle */}
                        <div className="mb-1.5 flex items-center justify-between">
                          <p className="text-xs text-zinc-700">
                            Send here
                            <span className="ml-1 text-zinc-800">({inRange.length})</span>
                          </p>
                          {inRange.length > 1 && (
                            <button
                              onClick={() =>
                                allInRangeSelected
                                  ? setSelectedShipIds(new Set())
                                  : setSelectedShipIds(new Set(inRange.map((c) => c.ship.id)))
                              }
                              className="text-xs text-zinc-700 hover:text-zinc-400 transition-colors"
                            >
                              {allInRangeSelected ? "Deselect all" : "Select all"}
                            </button>
                          )}
                        </div>

                        {/* Ship rows with checkboxes */}
                        <div className="space-y-1.5">
                          {inRange.map(({ ship, sys, etaHr }) => {
                            const isSelected = selectedShipIds.has(ship.id);
                            const pinnedSysName = ship.pinnedColonySystemId
                              ? (systemMap.get(ship.pinnedColonySystemId)?.name ?? ship.pinnedColonySystemId)
                              : null;
                            const isPinnedHere = ship.pinnedColonySystemId === selectedSystem.id;
                            return (
                              <div
                                key={ship.id}
                                className={`flex items-center gap-2 rounded border px-2 py-1.5 transition-colors ${
                                  isSelected
                                    ? "border-indigo-700/50 bg-indigo-950/30"
                                    : "border-zinc-800 bg-zinc-900/50"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleShipSelection(ship.id)}
                                  className="shrink-0 cursor-pointer accent-indigo-500"
                                />
                                {/* Clicking the info area also toggles */}
                                <div
                                  className="min-w-0 flex-1 cursor-pointer"
                                  onClick={() => toggleShipSelection(ship.id)}
                                >
                                  <p className="truncate text-xs font-medium text-zinc-200">
                                    {ship.name}
                                  </p>
                                  <p className="text-xs text-zinc-600">
                                    {sys.name} · {formatEta(etaHr)}
                                    {ship.dispatchMode !== "manual" && (
                                      <span className="ml-1 text-amber-600/80">· Auto</span>
                                    )}
                                    {isPinnedHere && (
                                      <span className="ml-1 text-indigo-500">· Pinned here</span>
                                    )}
                                    {pinnedSysName && !isPinnedHere && (
                                      <span className="ml-1 text-zinc-700">· Pinned: {pinnedSysName}</span>
                                    )}
                                  </p>
                                </div>
                                <button
                                  onClick={() => handleDispatchShip(ship.id)}
                                  disabled={shipDispatchLoading === ship.id || multiDispatchLoading}
                                  className="shrink-0 rounded border border-indigo-700 bg-indigo-950/50 px-2.5 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-900/60 hover:text-indigo-200 disabled:opacity-50 transition-colors"
                                >
                                  {shipDispatchLoading === ship.id ? "…" : "Send"}
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* Batch action buttons */}
                        {inRange.length > 1 && (
                          <div className="mt-2">
                            {selectedInRange.length > 0 ? (
                              <button
                                onClick={() => handleDispatchSelected(selectedInRange.map((c) => c.ship.id))}
                                disabled={multiDispatchLoading}
                                className="w-full rounded border border-indigo-600 bg-indigo-950/60 px-2 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-900/60 disabled:opacity-50 transition-colors"
                              >
                                {multiDispatchLoading
                                  ? "Sending…"
                                  : `Send selected (${selectedInRange.length})`}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleDispatchSelected(inRange.map((c) => c.ship.id))}
                                disabled={multiDispatchLoading}
                                className="w-full rounded border border-zinc-700 bg-zinc-900/50 px-2 py-1.5 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50 transition-colors"
                              >
                                {multiDispatchLoading ? "Sending…" : `Send all (${inRange.length})`}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Out-of-range ships (dimmed, no button) */}
                    {outOfRange.length > 0 && (
                      <div className="mb-3 space-y-1">
                        <p className="text-xs text-zinc-800">Out of range</p>
                        {outOfRange.map(({ ship, sys }) => (
                          <div key={ship.id} className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs text-zinc-700">{ship.name}</p>
                            <p className="text-xs text-zinc-800 shrink-0">{sys.name}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* In-transit ships */}
                    {shipsInTransit.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-zinc-700">In transit</p>
                        {shipsInTransit.map((ship) => {
                          const destName = ship.destinationSystemId
                            ? (systemMap.get(ship.destinationSystemId)?.name ?? ship.destinationSystemId)
                            : null;
                          const msLeft = ship.arriveAt
                            ? new Date(ship.arriveAt).getTime() - Date.now()
                            : null;
                          const pinnedSysName = ship.pinnedColonySystemId
                            ? (systemMap.get(ship.pinnedColonySystemId)?.name ?? ship.pinnedColonySystemId)
                            : null;
                          return (
                            <div key={ship.id} className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs text-zinc-600">{ship.name}</p>
                                {pinnedSysName && (
                                  <p className="text-xs text-indigo-600/70">
                                    Pinned → {pinnedSysName}
                                  </p>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                {destName && (
                                  <p className="text-xs text-indigo-400/70">→ {destName}</p>
                                )}
                                {msLeft !== null && (
                                  <p className="text-xs text-zinc-700">
                                    {msLeft > 0 ? formatEta(Math.max(0, msLeft / 3600000)) : "Arriving"}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Empty state */}
                    {inRange.length === 0 && shipsHere.length === 0 && shipsInTransit.length === 0 && outOfRange.length === 0 && (
                      <p className="text-xs text-zinc-700">No ships available.</p>
                    )}
                    {inRange.length === 0 && shipsHere.length + shipsInTransit.length + outOfRange.length === ships.length && (
                      <p className="text-xs text-zinc-800 text-center mt-1">No ships in range to dispatch here.</p>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Action buttons */}
            <div className="mt-auto border-t border-zinc-800 p-4 space-y-2">
              {travelError && (
                <p className="text-xs text-red-400">{travelError}</p>
              )}

              {/* Travel Here — with ETA preview */}
              {canTravel && (
                <button
                  onClick={handleTravel}
                  disabled={travelLoading}
                  className="w-full rounded border border-indigo-700 bg-indigo-950/60 px-3 py-2 text-xs font-medium text-indigo-300 hover:bg-indigo-900/60 hover:text-indigo-200 transition-colors disabled:opacity-50"
                >
                  {travelLoading
                    ? "Dispatching…"
                    : travelEtaHours !== null
                      ? `Travel Here · ${formatEta(travelEtaHours)}`
                      : `Travel Here · ${formatDist(distToSelected!)}`}
                </button>
              )}

              {/* Reachable but can't travel (no ship, or already in transit) */}
              {isReachable && !canTravel && !selectedSystem.isCurrentLocation && (
                <p className="text-xs text-zinc-700 text-center">
                  {!dockedShip
                    ? "No ship available to travel"
                    : selectedSystem.isInTransitTarget
                      ? "Ship already en route"
                      : "Cannot travel"}
                </p>
              )}

              {/* Out of range hint */}
              {!isReachable && !selectedSystem.isCurrentLocation && currentSystem && (
                <p className="text-xs text-zinc-700 text-center">
                  Out of range ({formatDist(distToSelected!)} &gt; {baseRangeLy} ly)
                </p>
              )}

              {/* Open System page */}
              <Link
                href={`/game/system/${encodeURIComponent(selectedSystem.id)}`}
                className="block w-full rounded border border-zinc-700 px-3 py-2 text-center text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
              >
                Open System Page →
              </Link>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
            <p className="text-xs text-zinc-600">Click a star or asteroid to inspect it.</p>
            {currentSystem && (
              <p className="mt-2 text-xs text-zinc-700">
                Ship at{" "}
                <span className="text-emerald-600">{currentSystem.name}</span>.{" "}
                Range: {baseRangeLy} ly.
              </p>
            )}
            {stationSystem && !currentSystem && (
              <p className="mt-2 text-xs text-zinc-700">
                Station at{" "}
                <span className="text-amber-600">{stationSystem.name}</span>.
              </p>
            )}
            {asteroids.length > 0 && (
              <p className="mt-2 text-xs text-zinc-700">
                {asteroids.length} active asteroid{asteroids.length !== 1 ? "s" : ""} in range.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
