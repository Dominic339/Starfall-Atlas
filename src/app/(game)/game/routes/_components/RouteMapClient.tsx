"use client";

/**
 * RouteMapClient — Phase 17 local route map with drag-to-connect.
 *
 * Layout:
 *   Left (60%): SVG local star map. Shows systems with player colonies.
 *               Hover a system node to see its colony list.
 *               Drag from a colony entry to another colony to create a route.
 *   Right (40%): Route table panel. Lists all routes, allows editing and deletion.
 *                Selecting a route highlights it on the map.
 *
 * Map projection:
 *   Uses catalog x,y coordinates (light-years from Sol, dropping z).
 *   Normalizes to SVG viewport (MAP_W × MAP_H) with padding.
 *
 * Drag-to-connect:
 *   mousedown on a colony list item → drag starts.
 *   mousemove over SVG → temporary line drawn.
 *   mouseup on a target colony list item → POST /api/game/colony/route/create.
 *   Escape or mouseup elsewhere → cancel.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ColonyMapEntry, RouteMapEntry } from "../page";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAP_W = 700;
const MAP_H = 500;
const MAP_PAD = 48;        // padding inside SVG viewport
const NODE_R = 10;          // system node radius
const COLONY_NODE_R = 14;   // larger when has colonies

const ALL_RESOURCES = [
  "iron", "carbon", "ice",
  "silica", "water", "biomass", "sulfur", "rare_crystal",
  "food", "steel", "glass", "fuel_cells", "polymers",
  "exotic_matter", "crystalline_core", "void_dust",
] as const;

const MODE_LABELS: Record<string, string> = {
  all:    "All — send everything",
  excess: "Excess — keep 100, send rest",
  fixed:  "Fixed amount per interval",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group colonies by system ID. */
function groupBySystem(
  colonies: ColonyMapEntry[],
): Map<string, ColonyMapEntry[]> {
  const m = new Map<string, ColonyMapEntry[]>();
  for (const c of colonies) {
    if (!m.has(c.systemId)) m.set(c.systemId, []);
    m.get(c.systemId)!.push(c);
  }
  return m;
}

/** Get unique systems from colony list. */
function uniqueSystems(colonies: ColonyMapEntry[]): ColonyMapEntry[] {
  const seen = new Set<string>();
  const result: ColonyMapEntry[] = [];
  for (const c of colonies) {
    if (!seen.has(c.systemId)) {
      seen.add(c.systemId);
      result.push(c);
    }
  }
  return result;
}

/** Normalize catalog x,y to SVG coords. */
function buildProjection(systems: ColonyMapEntry[]): {
  project: (x: number, y: number) => { svgX: number; svgY: number };
} {
  if (systems.length === 0) {
    return { project: () => ({ svgX: MAP_W / 2, svgY: MAP_H / 2 }) };
  }

  // Single system: center it
  if (systems.length === 1) {
    const cx = MAP_W / 2;
    const cy = MAP_H / 2;
    return { project: () => ({ svgX: cx, svgY: cy }) };
  }

  const xs = systems.map((s) => s.systemX);
  const ys = systems.map((s) => s.systemY);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const drawW = MAP_W - 2 * MAP_PAD;
  const drawH = MAP_H - 2 * MAP_PAD;

  // Preserve aspect ratio
  const scaleX = drawW / rangeX;
  const scaleY = drawH / rangeY;
  const scale = Math.min(scaleX, scaleY);

  // Center in viewport
  const offsetX = MAP_PAD + (drawW - rangeX * scale) / 2;
  const offsetY = MAP_PAD + (drawH - rangeY * scale) / 2;

  return {
    project: (x: number, y: number) => ({
      svgX: offsetX + (x - minX) * scale,
      // Invert Y so "up" in catalog = "up" on screen
      svgY: MAP_H - (offsetY + (y - minY) * scale),
    }),
  };
}

/** Spectral class color. */
function spectralColor(coloniesInSystem: ColonyMapEntry[]): string {
  // Color by whether it has transports (supply-capable)
  if (coloniesInSystem.some((c) => c.hasTransport)) return "#6ee7b7"; // emerald
  return "#818cf8"; // indigo
}

/** Colony display label: "Alpha Centauri · Body 2 (T3)" */
function colonyLabel(c: ColonyMapEntry): string {
  return `${c.systemName} · Body ${c.bodyIndex} (T${c.populationTier})`;
}

/** Short label for map overlay: "Body 2 (T3)" */
function colonyShortLabel(c: ColonyMapEntry): string {
  return `Body ${c.bodyIndex} (T${c.populationTier})`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DragState {
  fromColonyId: string;
  fromSystemId: string;
  svgX: number;
  svgY: number;
}

interface EditState {
  resourceType: string;
  mode: "all" | "excess" | "fixed";
  fixedAmount: string;
  intervalMinutes: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RouteMapClient({
  colonies,
  initialRoutes,
}: {
  colonies: ColonyMapEntry[];
  initialRoutes: RouteMapEntry[];
}) {
  const router = useRouter();

  // Routes are kept in local state so edits reflect immediately before refresh
  const [routes, setRoutes] = useState<RouteMapEntry[]>(initialRoutes);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [hoveredSystemId, setHoveredSystemId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragSvgPos, setDragSvgPos] = useState<{ x: number; y: number } | null>(null);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  // ── Derived data ──────────────────────────────────────────────────────────
  const bySystem = groupBySystem(colonies);
  const systemList = uniqueSystems(colonies);
  const { project } = buildProjection(systemList);

  /** Map: systemId → SVG {x,y} */
  const systemSvgPos = new Map<string, { x: number; y: number }>();
  for (const sys of systemList) {
    const pos = project(sys.systemX, sys.systemY);
    systemSvgPos.set(sys.systemId, { x: pos.svgX, y: pos.svgY });
  }

  /** Map: colonyId → colony entry (fast lookup) */
  const colonyById = new Map<string, ColonyMapEntry>(colonies.map((c) => [c.id, c]));

  // ── SVG mouse tracking for drag ───────────────────────────────────────────
  const getSvgPoint = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * MAP_W,
      y: ((e.clientY - rect.top) / rect.height) * MAP_H,
    };
  }, []);

  const handleSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!dragState) return;
      setDragSvgPos(getSvgPoint(e));
    },
    [dragState, getSvgPoint],
  );

  const handleSvgMouseUp = useCallback(() => {
    // Mouseup on empty SVG area → cancel drag
    setDragState(null);
    setDragSvgPos(null);
    setCreateError(null);
  }, []);

  // Cancel drag on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDragState(null);
        setDragSvgPos(null);
        setCreateError(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Drag start ────────────────────────────────────────────────────────────
  function startDrag(
    e: React.MouseEvent,
    fromColony: ColonyMapEntry,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sysPos = systemSvgPos.get(fromColony.systemId);
    setDragState({
      fromColonyId: fromColony.id,
      fromSystemId: fromColony.systemId,
      svgX: sysPos?.x ?? MAP_W / 2,
      svgY: sysPos?.y ?? MAP_H / 2,
    });
    setDragSvgPos({
      x: ((e.clientX - rect.left) / rect.width) * MAP_W,
      y: ((e.clientY - rect.top) / rect.height) * MAP_H,
    });
    setCreateError(null);
  }

  // ── Drop on target colony ─────────────────────────────────────────────────
  async function finishDrag(toColony: ColonyMapEntry) {
    if (!dragState) return;
    if (dragState.fromColonyId === toColony.id) {
      setDragState(null);
      setDragSvgPos(null);
      return;
    }

    const fromColony = colonyById.get(dragState.fromColonyId);
    if (!fromColony) return;

    // Compute min interval from distance
    const minInterval = computeMinInterval(fromColony, toColony);

    setActionLoading(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/game/colony/route/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromColonyId: dragState.fromColonyId,
          toColonyId: toColony.id,
          resourceType: "iron", // default — player edits in table
          mode: "excess",
          intervalMinutes: minInterval,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
        // Optimistically add to local state — real data comes on refresh
        const newRoute: RouteMapEntry = {
          id: json.data?.routeId ?? crypto.randomUUID(),
          fromColonyId: dragState.fromColonyId,
          toColonyId: toColony.id,
          resourceType: "iron",
          mode: "excess",
          fixedAmount: null,
          intervalMinutes: minInterval,
          lastRunAt: new Date().toISOString(),
        };
        setRoutes((prev) => [...prev, newRoute]);
        setSelectedRouteId(newRoute.id);
      } else {
        setCreateError(json.error?.message ?? "Failed to create route.");
      }
    } catch {
      setCreateError("Network error.");
    } finally {
      setActionLoading(false);
      setDragState(null);
      setDragSvgPos(null);
    }
  }

  // ── Compute minimum interval between two colonies ─────────────────────────
  function computeMinInterval(
    from: ColonyMapEntry,
    to: ColonyMapEntry,
  ): number {
    const MIN = 30;
    if (from.systemId === to.systemId) return MIN;
    const dx = from.systemX - to.systemX;
    const dy = from.systemY - to.systemY;
    const dz = from.systemZ - to.systemZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const roundTripMins = Math.ceil((2 * dist / 2.0) * 60);
    return Math.max(MIN, roundTripMins);
  }

  // ── Route deletion ────────────────────────────────────────────────────────
  async function deleteRoute(routeId: string) {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch("/api/game/colony/route/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId }),
      });
      const json = await res.json();
      if (json.ok) {
        setRoutes((prev) => prev.filter((r) => r.id !== routeId));
        if (selectedRouteId === routeId) setSelectedRouteId(null);
        if (editingRouteId === routeId) { setEditingRouteId(null); setEditState(null); }
        router.refresh();
      } else {
        setActionError(json.error?.message ?? "Failed to delete route.");
      }
    } catch {
      setActionError("Network error.");
    } finally {
      setActionLoading(false);
    }
  }

  // ── Route editing ─────────────────────────────────────────────────────────
  function startEdit(route: RouteMapEntry) {
    setEditingRouteId(route.id);
    setEditState({
      resourceType: route.resourceType,
      mode: route.mode,
      fixedAmount: route.fixedAmount?.toString() ?? "50",
      intervalMinutes: route.intervalMinutes.toString(),
    });
    setActionError(null);
  }

  async function saveEdit(route: RouteMapEntry) {
    if (!editState) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch("/api/game/colony/route/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeId: route.id,
          resourceType: editState.resourceType,
          mode: editState.mode,
          fixedAmount:
            editState.mode === "fixed"
              ? parseInt(editState.fixedAmount, 10)
              : undefined,
          intervalMinutes: parseInt(editState.intervalMinutes, 10),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        // Update local state
        setRoutes((prev) =>
          prev.map((r) =>
            r.id === route.id
              ? {
                  ...r,
                  resourceType: editState.resourceType,
                  mode: editState.mode,
                  fixedAmount:
                    editState.mode === "fixed"
                      ? parseInt(editState.fixedAmount, 10)
                      : null,
                  intervalMinutes: parseInt(editState.intervalMinutes, 10),
                }
              : r,
          ),
        );
        setEditingRouteId(null);
        setEditState(null);
        router.refresh();
      } else {
        setActionError(json.error?.message ?? "Failed to update route.");
      }
    } catch {
      setActionError("Network error.");
    } finally {
      setActionLoading(false);
    }
  }

  // ── Derived highlights ────────────────────────────────────────────────────
  const selectedRoute = routes.find((r) => r.id === selectedRouteId) ?? null;
  const highlightedColonyIds = new Set<string>(
    selectedRoute
      ? [selectedRoute.fromColonyId, selectedRoute.toColonyId]
      : [],
  );
  const highlightedSystemPairs = selectedRoute
    ? (() => {
        const from = colonyById.get(selectedRoute.fromColonyId);
        const to   = colonyById.get(selectedRoute.toColonyId);
        return from && to ? [from.systemId, to.systemId] : [];
      })()
    : [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left: SVG map ─────────────────────────────────────────────── */}
      <div className="relative flex flex-1 flex-col overflow-hidden border-r border-zinc-800">
        {/* Hint */}
        <div className="shrink-0 border-b border-zinc-800/50 px-3 py-1.5 text-xs text-zinc-600">
          Hover a system node to see its colonies. Drag from a colony to create a route.
          {createError && (
            <span className="ml-2 text-red-400">{createError}</span>
          )}
          {actionLoading && (
            <span className="ml-2 text-zinc-500">Working…</span>
          )}
        </div>

        {/* SVG container — fills remaining space */}
        <div className="relative flex-1 overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            className="h-full w-full"
            style={{ cursor: dragState ? "crosshair" : "default" }}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
          >
            {/* ── Route lines ───────────────────────────────────────── */}
            <defs>
              <marker
                id="arrow"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L6,3 z" fill="#4b5563" />
              </marker>
              <marker
                id="arrow-selected"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L6,3 z" fill="#818cf8" />
              </marker>
            </defs>

            {routes.map((route) => {
              const fromC = colonyById.get(route.fromColonyId);
              const toC   = colonyById.get(route.toColonyId);
              if (!fromC || !toC) return null;
              const fromPos = systemSvgPos.get(fromC.systemId);
              const toPos   = systemSvgPos.get(toC.systemId);
              if (!fromPos || !toPos) return null;
              const isSelected = route.id === selectedRouteId;

              // Offset same-system routes slightly so they don't stack
              const sameSystem = fromC.systemId === toC.systemId;
              const midX = sameSystem
                ? fromPos.x + 40
                : (fromPos.x + toPos.x) / 2;
              const midY = sameSystem
                ? fromPos.y - 30
                : (fromPos.y + toPos.y) / 2;

              const d = sameSystem
                ? `M ${fromPos.x} ${fromPos.y} Q ${midX} ${midY} ${toPos.x} ${toPos.y}`
                : `M ${fromPos.x} ${fromPos.y} L ${toPos.x} ${toPos.y}`;

              return (
                <path
                  key={route.id}
                  d={d}
                  fill="none"
                  stroke={isSelected ? "#818cf8" : "#374151"}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeDasharray={isSelected ? undefined : "4 3"}
                  markerEnd={isSelected ? "url(#arrow-selected)" : "url(#arrow)"}
                  className="cursor-pointer transition-colors"
                  onClick={() =>
                    setSelectedRouteId(isSelected ? null : route.id)
                  }
                />
              );
            })}

            {/* ── Drag preview line ──────────────────────────────────── */}
            {dragState && dragSvgPos && (
              <line
                x1={dragState.svgX}
                y1={dragState.svgY}
                x2={dragSvgPos.x}
                y2={dragSvgPos.y}
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="6 3"
                pointerEvents="none"
              />
            )}

            {/* ── System nodes ───────────────────────────────────────── */}
            {systemList.map((sys) => {
              const pos = systemSvgPos.get(sys.systemId);
              if (!pos) return null;
              const coloniesHere = bySystem.get(sys.systemId) ?? [];
              const isHovered = hoveredSystemId === sys.systemId;
              const isHighlighted = highlightedSystemPairs.includes(sys.systemId);
              const nodeR = coloniesHere.length > 0 ? COLONY_NODE_R : NODE_R;
              const color = spectralColor(coloniesHere);

              return (
                <g key={sys.systemId}>
                  {/* Glow ring for highlighted systems */}
                  {isHighlighted && (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={nodeR + 6}
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth={1.5}
                      opacity={0.5}
                    />
                  )}

                  {/* System node */}
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={nodeR}
                    fill={isHovered ? color : "#1f2937"}
                    stroke={isHighlighted ? "#818cf8" : color}
                    strokeWidth={isHovered ? 2.5 : 1.5}
                    className="cursor-pointer transition-all"
                    onMouseEnter={() => setHoveredSystemId(sys.systemId)}
                  />

                  {/* System name label */}
                  <text
                    x={pos.x}
                    y={pos.y + nodeR + 13}
                    textAnchor="middle"
                    fontSize={9}
                    fill={isHovered ? "#d1d5db" : "#6b7280"}
                    className="select-none pointer-events-none"
                  >
                    {sys.systemName}
                  </text>

                  {/* Colony count badge */}
                  {coloniesHere.length > 0 && (
                    <text
                      x={pos.x}
                      y={pos.y + 3.5}
                      textAnchor="middle"
                      fontSize={8}
                      fill={isHovered ? "#111827" : color}
                      fontWeight="600"
                      className="select-none pointer-events-none"
                    >
                      {coloniesHere.length}
                    </text>
                  )}

                  {/* ── Colony hover overlay ───────────────────────── */}
                  {isHovered && (
                    <foreignObject
                      x={pos.x + nodeR + 4}
                      y={pos.y - 10}
                      width={180}
                      height={coloniesHere.length * 30 + 28}
                      onMouseLeave={() => setHoveredSystemId(null)}
                    >
                      <div
                        // @ts-expect-error xmlns needed for foreignObject
                        xmlns="http://www.w3.org/1999/xhtml"
                        className="rounded border border-zinc-700 bg-zinc-900/95 p-1.5 shadow-lg"
                      >
                        <p className="mb-1 px-1 text-xs font-medium text-zinc-400">
                          {sys.systemName}
                        </p>
                        {coloniesHere.map((colony) => {
                          const isHighlightedColony = highlightedColonyIds.has(colony.id);
                          const isDragSource =
                            dragState?.fromColonyId === colony.id;
                          const canDrop =
                            dragState !== null &&
                            dragState.fromColonyId !== colony.id;

                          return (
                            <div
                              key={colony.id}
                              className={`
                                flex cursor-grab items-center gap-1.5 rounded px-1.5 py-1 text-xs
                                select-none transition-colors
                                ${isDragSource ? "bg-amber-900/40 text-amber-300" : ""}
                                ${isHighlightedColony && !isDragSource ? "bg-indigo-900/40 text-indigo-300" : ""}
                                ${!isDragSource && !isHighlightedColony ? "text-zinc-300 hover:bg-zinc-800" : ""}
                                ${canDrop ? "cursor-copy ring-1 ring-amber-500/40" : ""}
                              `}
                              onMouseDown={(e) => startDrag(e, colony)}
                              onMouseUp={
                                canDrop
                                  ? (e) => {
                                      e.stopPropagation();
                                      finishDrag(colony);
                                    }
                                  : undefined
                              }
                            >
                              {/* Transport indicator dot */}
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                  colony.hasTransport
                                    ? "bg-emerald-400"
                                    : "bg-zinc-600"
                                }`}
                                title={
                                  colony.hasTransport
                                    ? `${colony.transportTierLabel} · ${colony.transportCapacity}/period`
                                    : "No transport — routes inactive"
                                }
                              />
                              <span className="truncate">
                                {colonyShortLabel(colony)}
                              </span>
                              {/* Capacity chip */}
                              {colony.hasTransport && (
                                <span className="ml-auto shrink-0 rounded bg-zinc-800 px-1 text-zinc-500 text-[10px]">
                                  {colony.transportCapacity}/p
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Transparent mouse-leave reset for hover */}
          <div
            className="absolute inset-0 pointer-events-none"
            onMouseLeave={() => {
              if (!dragState) setHoveredSystemId(null);
            }}
          />
        </div>

        {/* Legend */}
        <div className="shrink-0 border-t border-zinc-800/50 px-3 py-1.5 flex gap-4 text-xs text-zinc-600">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            Has transport
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-indigo-400" />
            No transport
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 border-t-2 border-dashed border-zinc-600 w-4" />
            Route
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 border-t-2 border-indigo-400 w-4" />
            Selected
          </span>
        </div>
      </div>

      {/* ── Right: Route table panel ───────────────────────────────────────── */}
      <div className="flex w-96 flex-col overflow-hidden bg-zinc-950">
        <div className="shrink-0 border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">
            Routes
            <span className="ml-2 text-xs font-normal text-zinc-600">
              {routes.length}
            </span>
          </h2>
          {selectedRouteId && (
            <button
              onClick={() => setSelectedRouteId(null)}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Clear selection
            </button>
          )}
        </div>

        {actionError && (
          <div className="shrink-0 border-b border-red-900/40 bg-red-950/20 px-4 py-1.5 text-xs text-red-400">
            {actionError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {routes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <p className="text-sm text-zinc-600">No routes yet.</p>
              <p className="mt-1 text-xs text-zinc-700">
                Hover a system node and drag from a colony to create a route.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {routes.map((route) => {
                const fromColony = colonyById.get(route.fromColonyId);
                const toColony   = colonyById.get(route.toColonyId);
                const isSelected = route.id === selectedRouteId;
                const isEditing  = route.id === editingRouteId;

                return (
                  <div
                    key={route.id}
                    className={`group px-4 py-3 transition-colors ${
                      isSelected ? "bg-indigo-950/30" : "hover:bg-zinc-900/40"
                    }`}
                  >
                    {/* Route header */}
                    <div
                      className="flex items-start justify-between gap-2 cursor-pointer"
                      onClick={() =>
                        setSelectedRouteId(isSelected ? null : route.id)
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-xs font-medium text-zinc-300">
                          <span className="truncate text-emerald-400">
                            {fromColony
                              ? colonyLabel(fromColony)
                              : route.fromColonyId.slice(0, 8)}
                          </span>
                          <span className="shrink-0 text-zinc-600">→</span>
                          <span className="truncate text-indigo-400">
                            {toColony
                              ? colonyLabel(toColony)
                              : route.toColonyId.slice(0, 8)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-600">
                          <span className="rounded bg-zinc-800 px-1 py-0.5">
                            {route.resourceType}
                          </span>
                          <span>{route.mode}</span>
                          {route.mode === "fixed" && route.fixedAmount && (
                            <span>× {route.fixedAmount}</span>
                          )}
                          <span>{route.intervalMinutes}m interval</span>
                          {/* Phase 18: throughput cap from source colony */}
                          {fromColony && (
                            <span
                              className={fromColony.hasTransport ? "text-zinc-700" : "text-amber-700"}
                              title="Max units per interval (transport capacity)"
                            >
                              {fromColony.hasTransport
                                ? `cap ${fromColony.transportCapacity}/period`
                                : "no transport"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!isEditing && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(route);
                            }}
                            disabled={actionLoading}
                            className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors disabled:opacity-40"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRoute(route.id);
                          }}
                          disabled={actionLoading}
                          className="rounded px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-red-950/40 hover:text-red-400 transition-colors disabled:opacity-40"
                          title="Delete route"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* ── Inline edit form ─────────────────────────── */}
                    {isEditing && editState && (
                      <div
                        className="mt-3 space-y-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Resource */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-0.5">
                            <label className="text-xs text-zinc-600">Resource</label>
                            <select
                              value={editState.resourceType}
                              onChange={(e) =>
                                setEditState((s) =>
                                  s ? { ...s, resourceType: e.target.value } : s,
                                )
                              }
                              disabled={actionLoading}
                              className="w-full rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-200 focus:outline-none"
                            >
                              {ALL_RESOURCES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Mode */}
                          <div className="space-y-0.5">
                            <label className="text-xs text-zinc-600">Mode</label>
                            <select
                              value={editState.mode}
                              onChange={(e) =>
                                setEditState((s) =>
                                  s
                                    ? {
                                        ...s,
                                        mode: e.target.value as
                                          | "all"
                                          | "excess"
                                          | "fixed",
                                      }
                                    : s,
                                )
                              }
                              disabled={actionLoading}
                              className="w-full rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-200 focus:outline-none"
                            >
                              {Object.entries(MODE_LABELS).map(
                                ([val, label]) => (
                                  <option key={val} value={val}>
                                    {label}
                                  </option>
                                ),
                              )}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          {/* Interval */}
                          <div className="space-y-0.5">
                            <label className="text-xs text-zinc-600">
                              Interval (min)
                            </label>
                            <input
                              type="number"
                              min="30"
                              value={editState.intervalMinutes}
                              onChange={(e) =>
                                setEditState((s) =>
                                  s ? { ...s, intervalMinutes: e.target.value } : s,
                                )
                              }
                              disabled={actionLoading}
                              className="w-full rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-200 focus:outline-none"
                            />
                          </div>

                          {/* Fixed amount */}
                          {editState.mode === "fixed" && (
                            <div className="space-y-0.5">
                              <label className="text-xs text-zinc-600">
                                Amount
                              </label>
                              <input
                                type="number"
                                min="1"
                                value={editState.fixedAmount}
                                onChange={(e) =>
                                  setEditState((s) =>
                                    s
                                      ? { ...s, fixedAmount: e.target.value }
                                      : s,
                                  )
                                }
                                disabled={actionLoading}
                                className="w-full rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-200 focus:outline-none"
                              />
                            </div>
                          )}
                        </div>

                        {/* Save / Cancel */}
                        <div className="flex gap-2 pt-0.5">
                          <button
                            onClick={() => saveEdit(route)}
                            disabled={actionLoading}
                            className="rounded bg-indigo-800 px-2.5 py-1 text-xs font-medium text-indigo-100 hover:bg-indigo-700 transition-colors disabled:opacity-60"
                          >
                            {actionLoading ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={() => {
                              setEditingRouteId(null);
                              setEditState(null);
                              setActionError(null);
                            }}
                            disabled={actionLoading}
                            className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="shrink-0 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-700">
          Routes resolve lazily on Dashboard load. Transports required at source.
        </div>
      </div>
    </div>
  );
}
