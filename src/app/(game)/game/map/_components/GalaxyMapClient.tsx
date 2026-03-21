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
  /** Player's active colony count in this system */
  colonyCount: number;
  /** Player ship is docked here */
  hasDockedShip: boolean;
  /** Player fleet is docked here */
  hasDockedFleet: boolean;
  /** This is where the primary docked ship is (travel source) */
  isCurrentLocation: boolean;
  /** A ship is currently traveling to this system */
  isInTransitTarget: boolean;
}

export interface GalaxyShip {
  id: string;
  name: string;
  systemId: string | null;
  speedLyPerHr: number;
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

interface GalaxyMapClientProps {
  systems: GalaxySystem[];
  ships: GalaxyShip[];
  fleets: GalaxyFleet[];
  asteroids: GalaxyAsteroid[];
  pixelsPerLy: number;
  baseRangeLy: number;
  viewboxW: number;
  viewboxH: number;
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GalaxyMapClient({
  systems,
  ships,
  fleets,
  asteroids,
  pixelsPerLy,
  baseRangeLy,
  viewboxW,
  viewboxH,
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

  // ── Derived data ──────────────────────────────────────────────────────────
  const systemMap = new Map(systems.map((s) => [s.id, s]));
  const asteroidMap = new Map(asteroids.map((a) => [a.id, a]));
  const currentSystem = systems.find((s) => s.isCurrentLocation) ?? null;
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

  const endPan = useCallback(() => {
    isPanning.current = false;
  }, []);

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
  function handleStarClick(e: React.MouseEvent, systemId: string) {
    e.stopPropagation();
    setSelectedId((prev) => (prev === systemId ? null : systemId));
    setSelectedAsteroidId(null);
    setTravelError(null);
    setDispatchError(null);
  }

  function handleAsteroidClick(e: React.MouseEvent, asteroidId: string) {
    e.stopPropagation();
    setSelectedAsteroidId((prev) => (prev === asteroidId ? null : asteroidId));
    setSelectedId(null);
    setDispatchError(null);
    setTravelError(null);
  }

  function handleMapClick() {
    setSelectedId(null);
    setSelectedAsteroidId(null);
    setTravelError(null);
    setDispatchError(null);
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
          shipId: dockedShip.id,
          toSystemId: selectedSystem.id,
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
          style={{ cursor: isPanning.current ? "grabbing" : "grab" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
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

            {/* ── In-transit path line ─────────────────────────────────────── */}
            {currentSystem &&
              systems
                .filter((s) => s.isInTransitTarget)
                .map((target) => (
                  <line
                    key={`transit-${target.id}`}
                    x1={currentSystem.svgX}
                    y1={currentSystem.svgY}
                    x2={target.svgX}
                    y2={target.svgY}
                    stroke="#6366f1"
                    strokeWidth={1.5 / scale}
                    strokeDasharray={`${8 / scale} ${4 / scale}`}
                    opacity={0.6}
                    pointerEvents="none"
                  />
                ))}

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

                  {/* Star glow (discovered/important only) */}
                  {(sys.isDiscovered || sys.colonyCount > 0) && (
                    <circle
                      cx={sys.svgX}
                      cy={sys.svgY}
                      r={r * 2}
                      fill={color}
                      opacity={0.08}
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
                      isCurrent || isSelected
                        ? "url(#glow)"
                        : sys.isDiscovered
                          ? undefined
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

                  {/* In-transit target marker */}
                  {sys.isInTransitTarget && (
                    <circle
                      cx={sys.svgX}
                      cy={sys.svgY}
                      r={r + 4}
                      fill="none"
                      stroke="#6366f1"
                      strokeWidth={1 / scale}
                      strokeDasharray={`${3 / scale} ${3 / scale}`}
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
          </g>
        </svg>

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
            <span className="inline-block h-2 w-2 rotate-45 bg-yellow-300/70" />
            Asteroid
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
              <p className="mt-0.5 text-xs text-zinc-600">
                {selectedSystem.spectralClass}-class · {formatDist(selectedSystem.distanceFromSol)} from Sol
              </p>
            </div>

            {/* Stats */}
            <div className="divide-y divide-zinc-800/50 px-4 py-1">
              {/* Discovery */}
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-zinc-600">Discovery</span>
                <span className={`text-xs ${selectedSystem.isDiscovered ? "text-emerald-400" : "text-zinc-600"}`}>
                  {selectedSystem.isDiscovered
                    ? selectedSystem.isPlayerSteward
                      ? "Steward ★"
                      : "Discovered"
                    : "Unexplored"}
                </span>
              </div>

              {/* Distance from current */}
              {currentSystem && !selectedSystem.isCurrentLocation && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">From you</span>
                  <span className={`text-xs ${isReachable ? "text-zinc-300" : "text-zinc-600"}`}>
                    {formatDist(distToSelected!)}
                    {isReachable ? "" : " — out of range"}
                  </span>
                </div>
              )}

              {/* Current location badge */}
              {selectedSystem.isCurrentLocation && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">Status</span>
                  <span className="text-xs text-emerald-400">You are here</span>
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
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">Your colonies</span>
                  <span className="text-xs text-emerald-300">{selectedSystem.colonyCount}</span>
                </div>
              )}

              {/* Ships/Fleet */}
              {selectedSystem.hasDockedShip && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">Ships</span>
                  <span className="text-xs text-zinc-400">Docked</span>
                </div>
              )}
              {selectedSystem.hasDockedFleet && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600">Fleet</span>
                  <span className="text-xs text-violet-400">Present</span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-auto border-t border-zinc-800 p-4 space-y-2">
              {travelError && (
                <p className="text-xs text-red-400">{travelError}</p>
              )}

              {/* Travel Here */}
              {canTravel && (
                <button
                  onClick={handleTravel}
                  disabled={travelLoading}
                  className="w-full rounded border border-indigo-700 bg-indigo-950/60 px-3 py-2 text-xs font-medium text-indigo-300 hover:bg-indigo-900/60 hover:text-indigo-200 transition-colors disabled:opacity-50"
                >
                  {travelLoading ? "Dispatching…" : `Travel Here · ${formatDist(distToSelected!)}`}
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
            <p className="text-xs text-zinc-600">Click a star or asteroid to select it.</p>
            {currentSystem && (
              <p className="mt-2 text-xs text-zinc-700">
                You are at{" "}
                <span className="text-emerald-600">{currentSystem.name}</span>.
                <br />
                Travel range: {baseRangeLy} ly.
              </p>
            )}
            {asteroids.length > 0 && (
              <p className="mt-2 text-xs text-zinc-700">
                {asteroids.length} active asteroid{asteroids.length !== 1 ? "s" : ""} in the region.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
