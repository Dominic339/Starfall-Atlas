"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InventoryItem { resource: string; quantity: number; }
interface CargoItem { resource: string; quantity: number; }
interface ShipData {
  id: string; name: string; cargoCap: number; speedLyPerHr: number;
  dispatchMode: string; dispatchModeLabel: string;
  cargoUsed: number; cargo: CargoItem[];
  isDocked: boolean; isTraveling: boolean; isAway: boolean;
  currentSystemId: string | null; currentSystemName: string | null;
  destinationSystemId: string | null; destinationSystemName: string | null;
  arriveAt: string | null;
  pinnedColonyId: string | null; pinnedColonyLabel: string | null;
  autoState: string | null; autoStateLabel: string;
}
interface ColonyData {
  id: string; systemId: string; systemName: string; bodyIndex: string;
  populationTier: number; stockpileTotal: number;
  isServed: boolean; pinnedShipNames: string[];
}
interface RefineOption {
  output: string;
  inputs: Array<{ resource: string; quantity: number }>;
  maxBatches: number; canAfford: boolean;
}
interface NearbySystem { id: string; name: string; }
interface PanelData {
  station: { id: string; name: string; systemId: string; systemName: string };
  credits: number; creditsPerHour: number;
  inventory: InventoryItem[]; totalUnits: number;
  ships: ShipData[];
  colonies: ColonyData[];
  nearbySystemsForDispatch: NearbySystem[];
  refineOptions: RefineOption[];
}

interface StationMapPanelProps { onClose: () => void; }

// ---------------------------------------------------------------------------
// Visual config
// ---------------------------------------------------------------------------

const RES: Record<string, { label: string; color: string; glow: string; bg: string; border: string }> = {
  iron:    { label: "Iron",    color: "text-orange-400",  glow: "shadow-orange-900/40",  bg: "bg-orange-950/20",  border: "border-orange-900/40" },
  carbon:  { label: "Carbon",  color: "text-zinc-400",    glow: "shadow-zinc-800/40",    bg: "bg-zinc-800/30",    border: "border-zinc-700/40" },
  silica:  { label: "Silica",  color: "text-yellow-400",  glow: "shadow-yellow-900/40",  bg: "bg-yellow-950/20",  border: "border-yellow-900/40" },
  biomass: { label: "Biomass", color: "text-emerald-400", glow: "shadow-emerald-900/40", bg: "bg-emerald-950/20", border: "border-emerald-900/40" },
  water:   { label: "Water",   color: "text-sky-400",     glow: "shadow-sky-900/40",     bg: "bg-sky-950/20",     border: "border-sky-900/40" },
  steel:   { label: "Steel",   color: "text-blue-400",    glow: "shadow-blue-900/40",    bg: "bg-blue-950/20",    border: "border-blue-900/40" },
  glass:   { label: "Glass",   color: "text-cyan-400",    glow: "shadow-cyan-900/40",    bg: "bg-cyan-950/20",    border: "border-cyan-900/40" },
  food:    { label: "Food",    color: "text-lime-400",    glow: "shadow-lime-900/40",    bg: "bg-lime-950/20",    border: "border-lime-900/40" },
};

function resLabel(r: string) { return RES[r]?.label ?? r.charAt(0).toUpperCase() + r.slice(1); }
function resColor(r: string) { return RES[r]?.color ?? "text-zinc-300"; }
function resBg(r: string)    { return RES[r]?.bg    ?? "bg-zinc-800/30"; }
function resBorder(r: string){ return RES[r]?.border ?? "border-zinc-700/40"; }

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

function eta(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "arriving";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), rem = min % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ResourceCard({ item }: { item: InventoryItem }) {
  const r = item.resource;
  return (
    <div className={`relative flex flex-col gap-1 rounded-lg border px-3 py-2.5 overflow-hidden ${resBg(r)} ${resBorder(r)}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${resColor(r).replace("text-", "bg-")}`} />
      <span className={`text-[10px] font-bold uppercase tracking-widest ${resColor(r)}`}>{resLabel(r)}</span>
      <span className="font-mono text-lg font-bold text-zinc-100 tabular-nums leading-none">
        {item.quantity.toLocaleString()}
      </span>
    </div>
  );
}

function CargoBar({ used, cap }: { used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const color = pct > 85 ? "bg-amber-500" : pct > 0 ? "bg-teal-500" : "bg-zinc-700";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono tabular-nums shrink-0 ${used > 0 ? "text-teal-400" : "text-zinc-600"}`}>
        {used}/{cap}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stores tab
// ---------------------------------------------------------------------------

function StoresTab({
  data, onRefresh,
}: {
  data: PanelData;
  onRefresh: () => void;
}) {
  const [refineAmounts, setRefineAmounts] = useState<Record<string, string>>({});
  const [refineLoading, setRefineLoading] = useState<string | null>(null);
  const [refineMsg, setRefineMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleRefine(output: string) {
    const amt = parseInt(refineAmounts[output] ?? "1", 10);
    if (isNaN(amt) || amt < 1) return;
    setRefineLoading(output);
    setRefineMsg(null);
    try {
      const res = await fetch("/api/game/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType: output, amount: amt }),
      });
      const json = await res.json();
      if (json.ok) {
        setRefineMsg({ type: "ok", text: `Refined ${amt} ${resLabel(output)}.` });
        onRefresh();
      } else {
        setRefineMsg({ type: "err", text: json.error?.message ?? "Refine failed." });
      }
    } catch {
      setRefineMsg({ type: "err", text: "Network error." });
    } finally {
      setRefineLoading(null);
    }
  }

  return (
    <div className="space-y-5">

      {/* Credits hero */}
      <div className="rounded-lg border border-amber-900/40 bg-gradient-to-br from-amber-950/30 via-zinc-900/60 to-zinc-900 px-4 py-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700/80">Credits</p>
          <p className="mt-0.5 font-mono text-2xl font-bold text-amber-300 tabular-nums">
            {data.credits.toLocaleString()}
          </p>
        </div>
        {data.creditsPerHour > 0 && (
          <div className="text-right shrink-0">
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Income</p>
            <p className="font-mono text-sm font-semibold text-amber-600">
              +{data.creditsPerHour.toLocaleString()}<span className="text-xs text-amber-800"> ¢/hr</span>
            </p>
          </div>
        )}
      </div>

      {/* Inventory grid */}
      {data.inventory.length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Inventory</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.inventory.map((item) => <ResourceCard key={item.resource} item={item} />)}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 py-6 text-center">
          <p className="text-sm text-zinc-600">Station inventory is empty.</p>
          <p className="mt-1 text-xs text-zinc-700">Dispatch ships to haul resources from colonies.</p>
        </div>
      )}

      {/* Refine */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Refine</p>
        {refineMsg && (
          <p className={`mb-2 text-xs ${refineMsg.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
            {refineMsg.text}
          </p>
        )}
        <div className="space-y-2">
          {data.refineOptions.map((opt) => (
            <div
              key={opt.output}
              className={`rounded-lg border px-3 py-2.5 flex items-center gap-3 ${
                opt.canAfford
                  ? `${resBg(opt.output)} ${resBorder(opt.output)}`
                  : "border-zinc-800 bg-zinc-900/40"
              }`}
            >
              {/* Recipe */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {opt.inputs.map((inp, i) => (
                    <span key={inp.resource} className="flex items-center gap-1">
                      {i > 0 && <span className="text-zinc-700 text-xs">+</span>}
                      <span className={`text-xs font-medium ${resColor(inp.resource)}`}>{resLabel(inp.resource)}</span>
                    </span>
                  ))}
                  <span className="text-zinc-600 text-xs">→</span>
                  <span className={`text-xs font-bold ${resColor(opt.output)}`}>{resLabel(opt.output)}</span>
                </div>
                {opt.canAfford && (
                  <p className="text-[10px] text-zinc-600 mt-0.5">Max {opt.maxBatches.toLocaleString()} units</p>
                )}
                {!opt.canAfford && (
                  <p className="text-[10px] text-zinc-700 mt-0.5">
                    Need: {opt.inputs.map((i) => resLabel(i.resource)).join(" + ")}
                  </p>
                )}
              </div>
              {/* Controls */}
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number" min="1" max={opt.maxBatches || 1}
                  value={refineAmounts[opt.output] ?? "1"}
                  onChange={(e) => setRefineAmounts((p) => ({ ...p, [opt.output]: e.target.value }))}
                  disabled={!opt.canAfford}
                  className="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500 disabled:opacity-40 text-center"
                />
                <button
                  onClick={() => handleRefine(opt.output)}
                  disabled={!opt.canAfford || refineLoading === opt.output}
                  className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                    !opt.canAfford
                      ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                      : refineLoading === opt.output
                        ? "bg-zinc-700 text-zinc-400 cursor-wait"
                        : `${resBg(opt.output)} ${resColor(opt.output)} hover:brightness-125 border ${resBorder(opt.output)}`
                  }`}
                >
                  {refineLoading === opt.output ? "…" : "Refine"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fleet tab
// ---------------------------------------------------------------------------

function FleetTab({ data, onRefresh }: { data: PanelData; onRefresh: () => void }) {
  const router = useRouter();
  const [dispatchTarget, setDispatchTarget] = useState<Record<string, string>>({});
  const [travelLoading, setTravelLoading] = useState<string | null>(null);
  const [travelMsg, setTravelMsg] = useState<{ shipId: string; type: "ok" | "err"; text: string } | null>(null);
  const [modeLoading, setModeLoading] = useState<string | null>(null);

  async function handleDispatch(shipId: string) {
    const dest = dispatchTarget[shipId];
    if (!dest) return;
    setTravelLoading(shipId);
    setTravelMsg(null);
    try {
      const res = await fetch("/api/game/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationSystemId: dest, shipId }),
      });
      const json = await res.json();
      if (json.ok) {
        setTravelMsg({ shipId, type: "ok", text: "Dispatched!" });
        onRefresh(); router.refresh();
      } else {
        setTravelMsg({ shipId, type: "err", text: json.error?.message ?? "Dispatch failed." });
      }
    } catch {
      setTravelMsg({ shipId, type: "err", text: "Network error." });
    } finally {
      setTravelLoading(null);
    }
  }

  async function handleMode(shipId: string, mode: string) {
    setModeLoading(shipId);
    try {
      const res = await fetch("/api/game/ship/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipId, mode }),
      });
      const json = await res.json();
      if (json.ok) { onRefresh(); router.refresh(); }
    } finally {
      setModeLoading(null);
    }
  }

  const docked    = data.ships.filter((s) => s.isDocked);
  const traveling = data.ships.filter((s) => s.isTraveling);
  const away      = data.ships.filter((s) => s.isAway);

  function ShipGroup({ label, ships, dot }: { label: string; ships: ShipData[]; dot: string }) {
    if (ships.length === 0) return null;
    return (
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</p>
          <span className="text-[10px] text-zinc-700">{ships.length}</span>
        </div>
        <div className="space-y-2">
          {ships.map((ship) => {
            const isAuto = ship.dispatchMode !== "manual";
            const msg = travelMsg?.shipId === ship.id ? travelMsg : null;
            const dispatchTargets = data.nearbySystemsForDispatch.filter((s) => s.id !== ship.currentSystemId);

            return (
              <div key={ship.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                {/* Header row */}
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-200 truncate">{ship.name}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      {ship.speedLyPerHr.toFixed(1)} ly/hr
                      {ship.currentSystemName && (
                        <span className="ml-2 text-zinc-700">· {ship.currentSystemName}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    {isAuto && (
                      <span className="rounded border border-violet-800/50 bg-violet-950/30 px-1.5 py-0.5 text-[10px] text-violet-400">
                        {ship.dispatchModeLabel.replace("Auto: ", "")}
                      </span>
                    )}
                    {ship.isTraveling && ship.arriveAt && (
                      <span className="rounded border border-sky-800/40 bg-sky-950/20 px-1.5 py-0.5 text-[10px] text-sky-400">
                        ETA {eta(ship.arriveAt)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Cargo bar */}
                <div className="px-3 pb-2.5">
                  <CargoBar used={ship.cargoUsed} cap={ship.cargoCap} />
                  {ship.cargo.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5">
                      {ship.cargo.map((c) => (
                        <span key={c.resource} className={`text-[10px] ${resColor(c.resource)}`}>
                          {c.quantity.toLocaleString()} {resLabel(c.resource)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Travel destination + ETA */}
                {ship.isTraveling && ship.destinationSystemName && (
                  <div className="border-t border-zinc-800/60 px-3 py-2 flex items-center gap-2">
                    <span className="text-[10px] text-zinc-600">Traveling to</span>
                    <span className="text-[10px] font-semibold text-sky-400">{ship.destinationSystemName}</span>
                    {ship.arriveAt && (
                      <span className="ml-auto text-[10px] text-zinc-600">{eta(ship.arriveAt)}</span>
                    )}
                  </div>
                )}

                {/* Pinned colony */}
                {ship.pinnedColonyLabel && (
                  <div className="border-t border-zinc-800/60 px-3 py-1.5 flex items-center gap-2">
                    <span className="text-[10px] text-zinc-600">Assigned:</span>
                    <span className="text-[10px] text-violet-400">{ship.pinnedColonyLabel}</span>
                  </div>
                )}

                {/* Mode toggle row */}
                {ship.isDocked && (
                  <div className="border-t border-zinc-800/60 px-3 py-2 flex items-center gap-2">
                    <span className="text-[10px] text-zinc-600 shrink-0">Mode:</span>
                    <div className="flex gap-1 flex-wrap">
                      {(["manual", "auto_collect_nearest", "auto_collect_highest"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => handleMode(ship.id, m)}
                          disabled={modeLoading === ship.id}
                          className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            ship.dispatchMode === m
                              ? "bg-indigo-800/60 text-indigo-300 border border-indigo-700/40"
                              : "text-zinc-600 hover:text-zinc-400 border border-transparent"
                          }`}
                        >
                          {m === "manual" ? "Manual" : m === "auto_collect_nearest" ? "Auto: Nearest" : "Auto: Highest"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Manual dispatch */}
                {ship.isDocked && ship.dispatchMode === "manual" && dispatchTargets.length > 0 && (
                  <div className="border-t border-zinc-800/60 px-3 py-2 flex items-center gap-2">
                    <select
                      value={dispatchTarget[ship.id] ?? ""}
                      onChange={(e) => setDispatchTarget((p) => ({ ...p, [ship.id]: e.target.value }))}
                      className="flex-1 min-w-0 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                    >
                      <option value="">Dispatch to…</option>
                      {dispatchTargets.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleDispatch(ship.id)}
                      disabled={!dispatchTarget[ship.id] || travelLoading === ship.id}
                      className="shrink-0 rounded px-3 py-1 text-xs font-semibold border border-sky-800/50 bg-sky-950/30 text-sky-400 hover:bg-sky-900/40 disabled:opacity-40 transition-colors"
                    >
                      {travelLoading === ship.id ? "…" : "Send"}
                    </button>
                  </div>
                )}

                {msg && (
                  <div className={`border-t border-zinc-800/60 px-3 py-1.5 text-xs ${msg.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
                    {msg.text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (data.ships.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-zinc-600">No ships in fleet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ShipGroup label="At Station" ships={docked} dot="bg-emerald-500" />
      <ShipGroup label="In Transit" ships={traveling} dot="bg-sky-500" />
      <ShipGroup label="Away" ships={away} dot="bg-indigo-500" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colonies tab
// ---------------------------------------------------------------------------

function ColoniesTab({ data }: { data: PanelData }) {
  if (data.colonies.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-zinc-600">No active colonies.</p>
      </div>
    );
  }

  const maxStock = Math.max(...data.colonies.map((c) => c.stockpileTotal), 1);

  return (
    <div className="space-y-2">
      {data.colonies.map((col) => {
        const fillPct = Math.round((col.stockpileTotal / maxStock) * 100);
        return (
          <div key={col.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-400 truncate">{col.systemName}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">Body {col.bodyIndex}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${
                  col.populationTier >= 4 ? "border-amber-700/50 bg-amber-950/30 text-amber-400" :
                  col.populationTier >= 2 ? "border-indigo-800/50 bg-indigo-950/30 text-indigo-400" :
                  "border-zinc-700/50 bg-zinc-800/50 text-zinc-400"
                }`}>T{col.populationTier}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                  col.isServed
                    ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-400"
                    : "border-amber-800/50 bg-amber-950/20 text-amber-600"
                }`}>
                  {col.isServed ? "Served" : "Unserved"}
                </span>
              </div>
            </div>

            {/* Stockpile bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-600">Stockpile</span>
                <span className="font-mono text-[10px] text-zinc-400">{col.stockpileTotal.toLocaleString()}</span>
              </div>
              <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal-600/70"
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </div>

            {col.pinnedShipNames.length > 0 && (
              <p className="text-[10px] text-violet-400">
                {col.pinnedShipNames.join(", ")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function StationMapPanel({ onClose }: StationMapPanelProps) {
  const [tab, setTab] = useState<"stores" | "fleet" | "colonies">("stores");
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/game/station/panel");
      const json = await res.json();
      if (json.ok) setData(json.data as PanelData);
      else setError(json.error?.message ?? "Failed to load station data.");
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const dockedCount   = data?.ships.filter((s) => s.isDocked).length ?? 0;
  const travelCount   = data?.ships.filter((s) => s.isTraveling).length ?? 0;
  const awayCount     = data?.ships.filter((s) => s.isAway).length ?? 0;
  const colonyCount   = data?.colonies.length ?? 0;

  const TABS = [
    { id: "stores",   label: "Stores" },
    { id: "fleet",    label: `Fleet${data ? ` (${data.ships.length})` : ""}` },
    { id: "colonies", label: `Colonies${data ? ` (${colonyCount})` : ""}` },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl border border-zinc-700/80 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden">

        {/* Header */}
        <div className="shrink-0 border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-950 px-5 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-zinc-100">
                  {data?.station.name ?? "Station"}
                </h2>
                <span className="rounded border border-zinc-700/60 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Logistics Hub
                </span>
              </div>
              {data && (
                <p className="mt-0.5 text-xs text-amber-500/80">{data.station.systemName}</p>
              )}
              {/* Quick stats */}
              {data && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                  {dockedCount > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-zinc-400">{dockedCount} docked</span>
                    </span>
                  )}
                  {(travelCount + awayCount) > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                      <span className="text-zinc-400">{travelCount + awayCount} away</span>
                    </span>
                  )}
                  {colonyCount > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0" />
                      <span className="text-zinc-400">{colonyCount} {colonyCount === 1 ? "colony" : "colonies"}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none mt-0.5"
            >✕</button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="shrink-0 flex border-b border-zinc-800 px-4 pt-2 gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                tab === t.id
                  ? "bg-zinc-800 text-zinc-200 border-b-2 border-indigo-600"
                  : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="text-xs text-zinc-600 tracking-widest uppercase animate-pulse">Loading…</div>
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-400 text-center">
              {error}
            </div>
          )}
          {!loading && !error && data && (
            <>
              {tab === "stores"   && <StoresTab   data={data} onRefresh={refresh} />}
              {tab === "fleet"    && <FleetTab    data={data} onRefresh={refresh} />}
              {tab === "colonies" && <ColoniesTab data={data} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
