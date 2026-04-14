"use client";

/**
 * SystemHubClient — client-side shell for the interactive solar system view.
 *
 * Manages:
 *   - Which planet is selected (shows action panel in sidebar)
 *   - Supply-route drag state (drag one planet → drop on another)
 *   - Ship selection / ship-assignment mode (drag ship from list → click planet)
 *   - Station click → navigation to /game/station
 *
 * The 3D canvas lives inside SolarSceneWrapper. All interactive overlays and
 * the right-sidebar panel are plain HTML/React rendered on top.
 */

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SolarSceneWrapper } from "./SolarSceneWrapper";
import type { SolarSceneSystemData, SolarSceneShipData, SolarSceneFleetData } from "./SolarScene";

// ---------------------------------------------------------------------------
// Types coming from the server page
// ---------------------------------------------------------------------------

export interface BodyInfo {
  type:            string;
  size:            string;
  bodyId:          string;   // "{systemId}:{index}"
  colonyId:        string | null;
  populationTier:  number | null;
  isSurveyed:      boolean;
  isColonisable:   boolean;  // server-computed
}

export interface ShipInfo {
  id:              string;
  name:            string;
  dispatch_mode:   string;
  cargo_cap:       number;
  speed_ly_per_hr: number;
  ship_state:      string;
}

export interface FleetInfo {
  id:     string;
  name:   string;
  status: string;
}

export interface SystemHubClientProps {
  systemId:           string;
  system:             SolarSceneSystemData;
  bodies:             BodyInfo[];           // parallel to system.bodies, richer data
  ships:              ShipInfo[];
  fleets:             FleetInfo[];
  coloniesBodyIndices: number[];
  stationHere:        boolean;
  stationId:          string | null;
  isDiscovered:       boolean;
  canActOnBodies:     boolean;             // ship present + system accessible
  isFirstColony:      boolean;
  spectralClass:      string;
  bodyCount:          number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BODY_COLORS: Record<string, string> = {
  lush: "#4ade80", habitable: "#86efac", ocean: "#38bdf8",
  rocky: "#a8a29e", barren: "#78716c", desert: "#fbbf24",
  frozen: "#bae6fd", ice_planet: "#7dd3fc", ice_giant: "#67e8f9",
  gas_giant: "#fb923c", volcanic: "#f87171", toxic: "#a3e635",
  asteroid_belt: "#6b7280",
};

const SPECTRAL_COLORS: Record<string, string> = {
  O: "#93c5fd", B: "#93c5fd", A: "#bfdbfe",
  F: "#fef3c7", G: "#fde68a", K: "#fdba74", M: "#fca5a5",
};

function bodyLabel(type: string): string {
  return ({
    lush: "Lush", habitable: "Habitable", ocean: "Ocean", rocky: "Rocky",
    barren: "Barren", desert: "Desert", frozen: "Frozen", ice_planet: "Ice Planet",
    ice_giant: "Ice Giant", gas_giant: "Gas Giant", volcanic: "Volcanic",
    toxic: "Toxic", asteroid_belt: "Asteroid Belt",
  } as Record<string, string>)[type] ?? type;
}

function dispatchLabel(mode: string): string {
  if (mode === "auto_collect_nearest") return "Auto (nearest)";
  if (mode === "auto_collect_highest") return "Auto (highest)";
  return "Manual";
}

// ---------------------------------------------------------------------------
// Quick-action hook — fetch wrapper with loading + error state
// ---------------------------------------------------------------------------

function useApiAction() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  const run = useCallback(async (
    url: string,
    body: object,
    successMsg: string,
    onDone?: () => void,
  ) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res  = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Action failed.");
      } else {
        setSuccess(successMsg);
        router.refresh();
        onDone?.();
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  return { loading, error, success, run, setError, setSuccess };
}

// ---------------------------------------------------------------------------
// Planet action panel (right sidebar content when a planet is selected)
// ---------------------------------------------------------------------------

function PlanetPanel({
  body,
  bodyIndex,
  systemId,
  canActOnBodies,
  isFirstColony,
  onStartSupply,
  onClose,
}: {
  body:           BodyInfo;
  bodyIndex:      number;
  systemId:       string;
  canActOnBodies: boolean;
  isFirstColony:  boolean;
  onStartSupply:  () => void;
  onClose:        () => void;
}) {
  const survey = useApiAction();
  const found  = useApiAction();
  const collect = useApiAction();

  const dotColor = BODY_COLORS[body.type] ?? "#9ca3af";
  const label    = bodyLabel(body.type);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dotColor }} />
          <div>
            <p className="text-sm font-semibold text-zinc-100">
              Body {bodyIndex + 1} — {label}
            </p>
            <p className="text-xs text-zinc-500">{body.size} · {body.type}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-600 hover:text-zinc-300 text-lg leading-none px-1"
        >
          ×
        </button>
      </div>

      <div className="flex flex-col gap-3 px-4 py-3">

        {/* Colony status */}
        {body.colonyId ? (
          <div className="rounded border border-emerald-800/50 bg-emerald-950/30 px-3 py-2">
            <p className="text-xs font-medium text-emerald-400">
              Colony · Tier {body.populationTier ?? 1}
            </p>
            <Link
              href={`/game/colony/${body.colonyId}`}
              className="mt-1 block text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Full colony management →
            </Link>
          </div>
        ) : (
          <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2">
            <p className="text-xs text-zinc-500">No colony established</p>
          </div>
        )}

        {/* Survey */}
        {body.isSurveyed ? (
          <div className="flex items-center gap-2 text-xs text-teal-600">
            <span>✓</span><span>Surveyed</span>
          </div>
        ) : canActOnBodies ? (
          <div>
            <button
              onClick={() => survey.run(
                "/api/game/survey",
                { bodyId: body.bodyId },
                "Survey dispatched!",
              )}
              disabled={survey.loading}
              className="w-full rounded bg-teal-800/60 border border-teal-700/50 px-3 py-1.5 text-xs font-medium text-teal-300 hover:bg-teal-700/60 transition-colors disabled:opacity-50"
            >
              {survey.loading ? "Surveying…" : "Survey this body"}
            </button>
            {survey.error   && <p className="mt-1 text-xs text-red-400">{survey.error}</p>}
            {survey.success && <p className="mt-1 text-xs text-teal-400">{survey.success}</p>}
          </div>
        ) : (
          <p className="text-xs text-zinc-700">Ship must be present to survey</p>
        )}

        {/* Found colony */}
        {!body.colonyId && body.isColonisable && canActOnBodies && (
          <div>
            <button
              onClick={() => found.run(
                "/api/game/colony/found",
                { bodyId: body.bodyId },
                "Colony founded!",
              )}
              disabled={found.loading}
              className="w-full rounded bg-emerald-800/60 border border-emerald-700/50 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-700/60 transition-colors disabled:opacity-50"
            >
              {found.loading ? "Founding…" : "Found Colony"}
            </button>
            {isFirstColony && (
              <p className="mt-1 text-xs text-zinc-600">First colony is free.</p>
            )}
            {found.error   && <p className="mt-1 text-xs text-red-400">{found.error}</p>}
            {found.success && <p className="mt-1 text-xs text-emerald-400">{found.success}</p>}
          </div>
        )}

        {/* Colony actions (only if colonised) */}
        {body.colonyId && (
          <>
            <div className="border-t border-zinc-800/60 pt-3 space-y-2">
              <p className="text-xs text-zinc-600 uppercase tracking-wider">Colony Actions</p>

              {/* Collect taxes */}
              <button
                onClick={() => collect.run(
                  "/api/game/colony/collect",
                  { colonyId: body.colonyId },
                  "Taxes collected!",
                )}
                disabled={collect.loading}
                className="w-full rounded bg-amber-800/50 border border-amber-700/40 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-700/50 transition-colors disabled:opacity-50"
              >
                {collect.loading ? "Collecting…" : "Collect Taxes"}
              </button>
              {collect.error   && <p className="text-xs text-red-400">{collect.error}</p>}
              {collect.success && <p className="text-xs text-amber-400">{collect.success}</p>}

            </div>

            {/* Supply drag hint */}
            <div className="border-t border-zinc-800/60 pt-3">
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-2">Supply Routes</p>
              <button
                onClick={onStartSupply}
                className="w-full rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-indigo-600 hover:text-indigo-300 transition-colors"
              >
                Drag to planet → create supply route
              </button>
              <p className="mt-1 text-xs text-zinc-700">
                Or drag directly in the 3D view.
              </p>
            </div>
          </>
        )}

        {/* Link to full system actions */}
        <div className="border-t border-zinc-800/60 pt-3">
          <Link
            href={`/game/system/${encodeURIComponent(systemId)}`}
            className="block w-full rounded border border-zinc-800 px-3 py-1.5 text-center text-xs text-zinc-600 hover:border-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Full system page →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ship info panel
// ---------------------------------------------------------------------------

function ShipPanel({
  ship,
  bodies,
  systemId,
  assignMode,
  onStartAssign,
  onCancelAssign,
  onClose,
}: {
  ship:          ShipInfo;
  bodies:        BodyInfo[];
  systemId:      string;
  assignMode:    boolean;
  onStartAssign: () => void;
  onCancelAssign: () => void;
  onClose:       () => void;
}) {
  const assign = useApiAction();

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-indigo-400 shrink-0" />
          <p className="text-sm font-semibold text-zinc-100">{ship.name}</p>
        </div>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none px-1">×</button>
      </div>

      <div className="flex flex-col gap-3 px-4 py-3 text-xs">
        <div className="space-y-1 text-zinc-400">
          <p>Mode: <span className="text-zinc-200">{dispatchLabel(ship.dispatch_mode)}</span></p>
          <p>Cargo: <span className="text-zinc-200">{ship.cargo_cap} units</span></p>
          <p>Speed: <span className="text-zinc-200">{Number(ship.speed_ly_per_hr).toFixed(1)} ly/hr</span></p>
          <p>State: <span className="text-zinc-200">{ship.ship_state.replace(/_/g, " ")}</span></p>
        </div>

        {/* Assign to colony */}
        <div className="border-t border-zinc-800/60 pt-3">
          <p className="text-zinc-600 uppercase tracking-wider mb-2">Assign to Colony</p>
          {assignMode ? (
            <div className="space-y-2">
              <p className="text-zinc-500">Click a colonised planet in the 3D view to assign this ship.</p>
              <button
                onClick={onCancelAssign}
                className="w-full rounded border border-zinc-700 px-3 py-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={onStartAssign}
                className="w-full rounded bg-indigo-800/50 border border-indigo-700/40 px-3 py-1.5 font-medium text-indigo-300 hover:bg-indigo-700/50 transition-colors"
              >
                Click planet to assign →
              </button>
              {/* Inline colony selector */}
              {bodies.filter(b => b.colonyId).length > 0 && (
                <div className="mt-2 space-y-1">
                  {bodies.filter(b => b.colonyId).map((b, _i) => (
                    <button
                      key={b.colonyId}
                      disabled={assign.loading}
                      onClick={() => assign.run(
                        "/api/game/ship/assign-colony",
                        { shipId: ship.id, colonyId: b.colonyId },
                        `Assigned to ${bodyLabel(b.type)} colony`,
                      )}
                      className="w-full rounded border border-zinc-700 px-2 py-1 text-left text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-50"
                    >
                      {bodyLabel(b.type)} colony
                    </button>
                  ))}
                </div>
              )}
              {assign.error   && <p className="mt-1 text-red-400">{assign.error}</p>}
              {assign.success && <p className="mt-1 text-indigo-400">{assign.success}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System overview panel (default sidebar content)
// ---------------------------------------------------------------------------

function SystemOverviewPanel({
  systemId,
  system,
  bodies,
  ships,
  fleets,
  stationHere,
  isDiscovered,
  spectralClass,
  bodyCount,
  onSelectBody,
  onSelectShip,
  draggingShipId,
  onShipDragStart,
}: {
  systemId:      string;
  system:        SolarSceneSystemData;
  bodies:        BodyInfo[];
  ships:         ShipInfo[];
  fleets:        FleetInfo[];
  stationHere:   boolean;
  isDiscovered:  boolean;
  spectralClass: string;
  bodyCount:     number;
  onSelectBody:  (idx: number) => void;
  onSelectShip:  (id: string) => void;
  draggingShipId: string | null;
  onShipDragStart: (shipId: string) => void;
}) {
  return (
    <div className="flex flex-col overflow-y-auto h-full">
      {/* System header */}
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full shrink-0"
            style={{ background: SPECTRAL_COLORS[spectralClass] ?? "#d1d5db" }} />
          <h2 className="font-semibold text-zinc-200 truncate">{system.name}</h2>
        </div>
        <p className="mt-0.5 text-xs text-zinc-600">
          {spectralClass}-class · {bodyCount} bodies
          {isDiscovered && " · Discovered"}
        </p>
      </div>

      {/* Station */}
      {stationHere && (
        <div className="border-b border-zinc-800/50 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400 opacity-80" />
            <span className="text-xs text-amber-400 font-medium">Your Station</span>
          </div>
          <Link href="/game/station"
            className="mt-1 block text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
            View station inventory →
          </Link>
        </div>
      )}

      {/* Ships */}
      {ships.length > 0 && (
        <div className="border-b border-zinc-800/50 px-4 py-2">
          <p className="mb-1.5 text-xs text-zinc-600 uppercase tracking-wider">
            Ships ({ships.length})
          </p>
          <div className="space-y-1">
            {ships.map((ship) => (
              <div
                key={ship.id}
                className={`flex items-center gap-2 rounded px-1 py-0.5 transition-colors cursor-pointer ${
                  draggingShipId === ship.id ? "bg-indigo-900/40" : "hover:bg-zinc-800/50"
                }`}
                onClick={() => onSelectShip(ship.id)}
                // Pointer drag from sidebar → assign ship to colony
                onPointerDown={() => onShipDragStart(ship.id)}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
                <span className="truncate text-xs text-zinc-300 flex-1">{ship.name}</span>
                {ship.dispatch_mode !== "manual" && (
                  <span className="shrink-0 text-xs text-teal-600">Auto</span>
                )}
                <span className="text-xs text-zinc-700">ℹ</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-zinc-700">
            Click ship for info · drag to planet to assign
          </p>
        </div>
      )}

      {/* Fleets */}
      {fleets.length > 0 && (
        <div className="border-b border-zinc-800/50 px-4 py-2">
          <p className="mb-1.5 text-xs text-zinc-600 uppercase tracking-wider">
            Fleets ({fleets.length})
          </p>
          <div className="space-y-1">
            {fleets.map((fleet) => (
              <div key={fleet.id} className="flex items-center gap-2">
                <span className="h-0 w-0 shrink-0 border-l-4 border-r-4 border-b-[5px]
                  border-l-transparent border-r-transparent border-b-violet-400" />
                <span className="truncate text-xs text-zinc-300 flex-1">{fleet.name}</span>
                <Link href={`/game/fleet/${fleet.id}`}
                  className="text-xs text-zinc-700 hover:text-zinc-400 transition-colors">→</Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bodies list — click to select */}
      <div className="px-4 py-2 flex-1">
        <p className="mb-1.5 text-xs text-zinc-600 uppercase tracking-wider">Bodies</p>
        <div className="space-y-1">
          {bodies.map((body, i) => (
            <button
              key={i}
              onClick={() => body.type !== "asteroid_belt" ? onSelectBody(i) : undefined}
              className={`w-full flex items-center gap-2 rounded px-1 py-0.5 text-left transition-colors ${
                body.type === "asteroid_belt"
                  ? "cursor-default"
                  : "hover:bg-zinc-800/60 cursor-pointer"
              }`}
            >
              <span className="h-2 w-2 rounded-full shrink-0"
                style={{ background: BODY_COLORS[body.type] ?? "#9ca3af" }} />
              <span className="text-xs text-zinc-500 flex-1 truncate">
                {i + 1}. {bodyLabel(body.type)}
              </span>
              <span className="text-xs text-zinc-700">{body.size}</span>
              {body.colonyId && <span className="text-xs text-emerald-500">★</span>}
              {body.type !== "asteroid_belt" && !body.colonyId && (
                <span className="text-xs text-zinc-800">›</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom links */}
      <div className="border-t border-zinc-800 p-3 space-y-1.5">
        <Link
          href={`/game/system/${encodeURIComponent(systemId)}`}
          className="block w-full rounded border border-zinc-700 px-3 py-1.5 text-center text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
        >
          Full system detail →
        </Link>
        <Link
          href="/game/map"
          className="block w-full rounded border border-zinc-800 px-3 py-1.5 text-center text-xs text-zinc-700 hover:text-zinc-400 transition-colors"
        >
          ← Galaxy Map
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export function SystemHubClient({
  systemId, system, bodies, ships, fleets, coloniesBodyIndices,
  stationHere, stationId, isDiscovered, canActOnBodies, isFirstColony,
  spectralClass, bodyCount,
}: SystemHubClientProps) {
  const router = useRouter();

  // ── Panel state ────────────────────────────────────────────────────────────
  const [selectedBodyIdx, setSelectedBodyIdx] = useState<number | null>(null);
  const [selectedShipId,  setSelectedShipId]  = useState<string | null>(null);

  // ── Supply-drag state ──────────────────────────────────────────────────────
  const [supplySourceIdx, setSupplySourceIdx] = useState<number | null>(null);
  const [supplyMsg,       setSupplyMsg]       = useState<string | null>(null);
  const supplyLoading = useRef(false);

  // ── Ship-assignment state ──────────────────────────────────────────────────
  const [shipAssignId,   setShipAssignId]   = useState<string | null>(null);  // ship being assigned
  const [draggingShipId, setDraggingShipId] = useState<string | null>(null);  // sidebar drag

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedBody = selectedBodyIdx !== null ? bodies[selectedBodyIdx] : null;
  const selectedShip = selectedShipId  ? ships.find(s => s.id === selectedShipId) : null;

  // ── Callbacks passed to SolarScene ────────────────────────────────────────

  const handlePlanetClick = useCallback((idx: number) => {
    // If in ship-assign mode, assign to that colony
    if (shipAssignId) {
      const body = bodies[idx];
      if (!body?.colonyId) {
        setSupplyMsg("That planet has no colony to assign a ship to.");
        setShipAssignId(null);
        setDraggingShipId(null);
        return;
      }
      fetch("/api/game/ship/assign-colony", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipId: shipAssignId, colonyId: body.colonyId }),
      }).then(r => r.json()).then(json => {
        setSupplyMsg(json.ok ? "Ship assigned to colony!" : (json.error?.message ?? "Assignment failed."));
        router.refresh();
      }).catch(() => setSupplyMsg("Network error."));
      setShipAssignId(null);
      setDraggingShipId(null);
      return;
    }

    // If in supply mode, treat click on another planet as the drop target
    if (supplySourceIdx !== null && idx !== supplySourceIdx) {
      handleSupplyDrop(idx);
      return;
    }

    // Normal: toggle planet panel; deselect ship panel
    setSelectedShipId(null);
    setSelectedBodyIdx(prev => prev === idx ? null : idx);
  }, [shipAssignId, supplySourceIdx, bodies]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSupplyDragStart = useCallback((idx: number) => {
    setSupplySourceIdx(idx);
    setSelectedBodyIdx(null);
    setSelectedShipId(null);
  }, []);

  const handleSupplyDrop = useCallback((toIdx: number) => {
    if (supplySourceIdx === null || supplyLoading.current) return;
    const from = bodies[supplySourceIdx];
    const to   = bodies[toIdx];

    if (!from?.colonyId || !to?.colonyId) {
      setSupplyMsg("Both planets need active colonies to create a supply route.");
      setSupplySourceIdx(null);
      return;
    }

    supplyLoading.current = true;
    setSupplyMsg(null);

    fetch("/api/game/colony/route/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromColonyId: from.colonyId,
        toColonyId:   to.colonyId,
        resourceType: "iron",
        mode:         "all",
      }),
    })
      .then(r => r.json())
      .then(json => {
        setSupplyMsg(
          json.ok
            ? `Supply route created: ${bodyLabel(from.type)} → ${bodyLabel(to.type)}`
            : (json.error?.message ?? "Failed to create route.")
        );
        if (json.ok) router.refresh();
      })
      .catch(() => setSupplyMsg("Network error creating route."))
      .finally(() => { supplyLoading.current = false; });

    setSupplySourceIdx(null);
  }, [supplySourceIdx, bodies, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSupplyCancel = useCallback(() => {
    setSupplySourceIdx(null);
  }, []);

  const handleStationClick = useCallback(() => {
    router.push("/game/station");
  }, [router]);

  const handleShipClick = useCallback((id: string) => {
    setSelectedBodyIdx(null);
    setSelectedShipId(prev => prev === id ? null : id);
  }, []);

  // Ship drag from sidebar → assign to colony mode
  const handleShipDragStart = useCallback((shipId: string) => {
    setDraggingShipId(shipId);
    setShipAssignId(shipId);
    setSelectedShipId(null);
    setSelectedBodyIdx(null);
    setSupplySourceIdx(null);
  }, []);

  // Build scene ship data (pass extra fields for ship markers)
  const sceneShips = ships.map(s => ({
    id: s.id,
    name: s.name,
    dispatch_mode: s.dispatch_mode,
    cargo_cap: s.cargo_cap,
    speed_ly_per_hr: s.speed_ly_per_hr,
    ship_state: s.ship_state,
  }));

  const sceneFleets = fleets.map(f => ({
    id: f.id,
    name: f.name,
    status: f.status,
  }));

  // Determine sidebar content
  const showPlanetPanel = selectedBody !== null && selectedBodyIdx !== null;
  const showShipPanel   = selectedShip !== null;
  const showOverview    = !showPlanetPanel && !showShipPanel;

  // ESC key cancels modes
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSupplySourceIdx(null);
      setShipAssignId(null);
      setDraggingShipId(null);
      setSelectedBodyIdx(null);
      setSelectedShipId(null);
    }
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden" onKeyDown={handleKeyDown} tabIndex={-1}>

      {/* ── 3D canvas area ─────────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        <SolarSceneWrapper
          system={system}
          ships={sceneShips}
          fleets={sceneFleets}
          coloniesBodyIndices={coloniesBodyIndices}
          stationHere={stationHere}
          selectedBodyIndex={selectedBodyIdx}
          supplySourceIdx={supplySourceIdx}
          selectedShipId={selectedShipId}
          onPlanetClick={handlePlanetClick}
          onSupplyDragStart={handleSupplyDragStart}
          onSupplyDrop={handleSupplyDrop}
          onSupplyCancel={handleSupplyCancel}
          onStationClick={handleStationClick}
          onShipClick={handleShipClick}
        />

        {/* Supply mode banner */}
        {supplySourceIdx !== null && (
          <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-10
            rounded-full bg-amber-900/85 border border-amber-700 px-5 py-2 text-xs text-amber-200 backdrop-blur-sm">
            Supply mode — drag or click another planet · ESC to cancel
          </div>
        )}

        {/* Ship-assign mode banner */}
        {shipAssignId && (
          <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-10
            rounded-full bg-indigo-900/85 border border-indigo-700 px-5 py-2 text-xs text-indigo-200 backdrop-blur-sm">
            Ship assignment — click a planet colony · ESC to cancel
          </div>
        )}

        {/* Toast message */}
        {supplyMsg && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3
            rounded-lg bg-zinc-800/90 border border-zinc-700 px-4 py-2 text-xs text-zinc-200 backdrop-blur-sm">
            {supplyMsg}
            <button
              onClick={() => setSupplyMsg(null)}
              className="text-zinc-500 hover:text-zinc-300 text-base leading-none"
            >×</button>
          </div>
        )}

        {/* Hint */}
        <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-zinc-700 select-none">
          Drag to orbit · Scroll to zoom · Click planet for actions · Drag planet → supply route
        </p>
      </div>

      {/* ── Right sidebar ──────────────────────────────────────────────────── */}
      <div className="flex w-64 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950 text-xs overflow-hidden">
        {showPlanetPanel && selectedBody && selectedBodyIdx !== null && (
          <PlanetPanel
            body={selectedBody}
            bodyIndex={selectedBodyIdx}
            systemId={systemId}
            canActOnBodies={canActOnBodies}
            isFirstColony={isFirstColony}
            onStartSupply={() => {
              setSupplySourceIdx(selectedBodyIdx);
              setSelectedBodyIdx(null);
            }}
            onClose={() => setSelectedBodyIdx(null)}
          />
        )}

        {showShipPanel && selectedShip && (
          <ShipPanel
            ship={selectedShip}
            bodies={bodies}
            systemId={systemId}
            assignMode={shipAssignId === selectedShip.id}
            onStartAssign={() => {
              setShipAssignId(selectedShip.id);
              setDraggingShipId(selectedShip.id);
            }}
            onCancelAssign={() => {
              setShipAssignId(null);
              setDraggingShipId(null);
            }}
            onClose={() => setSelectedShipId(null)}
          />
        )}

        {showOverview && (
          <SystemOverviewPanel
            systemId={systemId}
            system={system}
            bodies={bodies}
            ships={ships}
            fleets={fleets}
            stationHere={stationHere}
            isDiscovered={isDiscovered}
            spectralClass={spectralClass}
            bodyCount={bodyCount}
            onSelectBody={setSelectedBodyIdx}
            onSelectShip={setSelectedShipId}
            draggingShipId={draggingShipId}
            onShipDragStart={handleShipDragStart}
          />
        )}
      </div>
    </div>
  );
}
