"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BuildOption {
  type: string;
  currentTier: number;
  targetTier: number;
  cost: { iron: number; carbon: number } | null;
  canAfford: boolean;
  atMax: boolean;
}

interface ColonySummary {
  id: string;
  bodyIndex: number;
  systemName: string;
  planetType: string | null;
  isHarsh: boolean;
  status: "active" | "abandoned" | "collapsed";
  populationTier: number;
  health: "well_supplied" | "struggling" | "neglected";
  healthPct: number;
  growthLabel: string | null;
  upkeepMissedPeriods: number;
  upkeepDesc: string;
  accruedTax: number;
  inventoryTotal: number;
  inventory: { resourceType: string; quantity: number }[];
  totalRatePerHr: number;
  basicNodeCount: number;
  extractorTier: number;
  isCapped: boolean;
  buildOptions: BuildOption[];
  shipsInSystem: { id: string; name: string; cargoCap: number; isAssigned: boolean }[];
  euxOptions: { resourceType: "iron" | "carbon" | "ice"; pricePerUnit: number }[];
  euxDailyUsed: number;
  euxDailyLimit: number;
  abandonedAt: string | null;
  resolutionWindowDays: number;
}

interface PanelData {
  colonies: ColonySummary[];
  playerCredits: number;
  stationIron: number;
}

interface ColonyMapPanelProps {
  systemId: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BODY_LABELS: Record<string, string> = {
  lush: "Lush", ocean: "Ocean", desert: "Desert", ice_planet: "Ice",
  volcanic: "Volcanic", toxic: "Toxic", rocky: "Rocky", habitable: "Habitable",
  barren: "Barren", frozen: "Frozen", gas_giant: "Gas Giant",
  ice_giant: "Ice Giant", asteroid_belt: "Asteroid Belt",
};

const STRUCT_LABELS: Record<string, string> = {
  warehouse: "Warehouse",
  extractor: "Extractor",
  habitat_module: "Habitat Module",
};

const STRUCT_DESC: Record<string, string> = {
  warehouse: "Increases storage capacity",
  extractor: "Boosts extraction rate",
  habitat_module: "Reduces upkeep consumption",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HealthBar({ pct, health }: { pct: number; health: string }) {
  const color =
    health === "neglected" ? "bg-red-600" :
    health === "struggling" ? "bg-amber-500" :
    "bg-emerald-600";
  const textColor =
    health === "neglected" ? "text-red-500" :
    health === "struggling" ? "text-amber-500" :
    "text-emerald-600";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full progress-fill ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono shrink-0 ${textColor}`}>{pct}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ColonyMapPanel({ systemId, onClose }: ColonyMapPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // Action states
  const [collectLoading, setCollectLoading] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [buildLoading, setBuildLoading] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const [reactivateError, setReactivateError] = useState<string | null>(null);
  const [euxLoading, setEuxLoading] = useState(false);
  const [euxError, setEuxError] = useState<string | null>(null);
  const [euxQty, setEuxQty] = useState(1);
  const [euxResource, setEuxResource] = useState<"iron" | "carbon" | "ice">("iron");

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/colony/panel?systemId=${encodeURIComponent(systemId)}`);
      const json = await res.json();
      if (json.ok) {
        setData(json.data as PanelData);
      } else {
        setError(json.error?.message ?? "Failed to load colony data.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => { void refetch(); }, [refetch, refreshKey]);

  const afterAction = () => {
    setRefreshKey((k) => k + 1);
    router.refresh();
  };

  async function handleCollect(colonyId: string) {
    setCollectLoading(true);
    setCollectError(null);
    try {
      const res = await fetch("/api/game/colony/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId }),
      });
      const json = await res.json();
      if (!json.ok) setCollectError(json.error?.message ?? "Collection failed.");
      else afterAction();
    } catch { setCollectError("Network error."); }
    finally { setCollectLoading(false); }
  }

  async function handleBuild(colonyId: string, structureType: string) {
    setBuildLoading(structureType);
    setBuildError(null);
    try {
      const res = await fetch("/api/game/colony/build-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId, structureType }),
      });
      const json = await res.json();
      if (!json.ok) setBuildError(json.error?.message ?? "Build failed.");
      else afterAction();
    } catch { setBuildError("Network error."); }
    finally { setBuildLoading(null); }
  }

  async function handleReactivate(colonyId: string) {
    setReactivateLoading(true);
    setReactivateError(null);
    try {
      const res = await fetch("/api/game/colony/reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId }),
      });
      const json = await res.json();
      if (!json.ok) setReactivateError(json.error?.message ?? "Reactivation failed.");
      else afterAction();
    } catch { setReactivateError("Network error."); }
    finally { setReactivateLoading(false); }
  }

  async function handleEuxBuy(colonyId: string) {
    setEuxLoading(true);
    setEuxError(null);
    try {
      const res = await fetch("/api/game/eux/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId, resourceType: euxResource, quantity: euxQty }),
      });
      const json = await res.json();
      if (!json.ok) setEuxError(json.error?.message ?? "Purchase failed.");
      else afterAction();
    } catch { setEuxError("Network error."); }
    finally { setEuxLoading(false); }
  }

  const colony = data?.colonies[activeTab] ?? null;
  const playerCredits = data?.playerCredits ?? 0;

  const euxSelected = colony?.euxOptions.find((o) => o.resourceType === euxResource);
  const euxTotalCost = (euxSelected?.pricePerUnit ?? 0) * euxQty;
  const euxRemaining = colony ? colony.euxDailyLimit - colony.euxDailyUsed : 0;
  const euxCanBuy = playerCredits >= euxTotalCost && euxRemaining >= euxQty && euxQty > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden animate-fade-in-up">

        {/* Header */}
        <div className="relative flex items-center justify-between gap-3 border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-950 px-5 py-3 shrink-0 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-200">Colony Management</h2>
            {colony && (
              <p className="mt-0.5 text-xs text-amber-500/80">{colony.systemName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tab bar (multiple colonies) */}
        {data && data.colonies.length > 1 && (
          <div className="flex items-center gap-1 border-b border-zinc-800/60 px-4 py-2 shrink-0">
            {data.colonies.map((c, i) => (
              <button
                key={c.id}
                onClick={() => setActiveTab(i)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  i === activeTab
                    ? "bg-zinc-800/80 text-zinc-100 border border-zinc-700/60"
                    : "text-zinc-600 hover:text-zinc-300 border border-transparent"
                }`}
              >
                Body {c.bodyIndex}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

          {loading && (
            <p className="text-xs text-zinc-600 text-center py-8">Loading colony data…</p>
          )}

          {error && (
            <p className="text-xs text-red-400 text-center py-8">{error}</p>
          )}

          {!loading && data?.colonies.length === 0 && (
            <p className="text-xs text-zinc-600 text-center py-8">No colonies found in this system.</p>
          )}

          {!loading && colony && (() => {
            const healthBadge = {
              well_supplied: "bg-emerald-900/50 text-emerald-400 border-emerald-900/40",
              struggling:    "bg-amber-900/50 text-amber-400 border-amber-900/40",
              neglected:     "bg-red-900/50 text-red-400 border-red-900/40",
            }[colony.health];

            const healthLabel = {
              well_supplied: "Supplied",
              struggling: "Struggling",
              neglected: "Neglected",
            }[colony.health];

            return (
              <>
                {/* Colony header card — themed by planet type */}
                {(() => {
                  const pt = colony.planetType;
                  const isGreen = pt === "lush" || pt === "habitable" || pt === "ocean";
                  const isDesert = pt === "desert";
                  const isFrozen = pt === "ice_planet" || pt === "frozen" || pt === "ice_giant";
                  const isToxic = pt === "toxic";
                  const isGas = pt === "gas_giant";
                  const borderCls = colony.isHarsh ? "border-red-900/40" : isGreen ? "border-emerald-900/30" : isDesert ? "border-amber-900/30" : isFrozen ? "border-sky-900/30" : isToxic ? "border-violet-900/30" : "border-zinc-800";
                  const gradFrom = colony.isHarsh ? "from-red-950/30" : isGreen ? "from-emerald-950/30" : isDesert ? "from-amber-950/30" : isFrozen ? "from-sky-950/30" : isToxic ? "from-violet-950/30" : isGas ? "from-orange-950/20" : "from-zinc-900/60";
                  const accentVia = colony.isHarsh ? "via-red-500/35" : isGreen ? "via-emerald-500/35" : isDesert ? "via-amber-500/35" : isFrozen ? "via-sky-400/35" : isToxic ? "via-violet-500/35" : isGas ? "via-orange-500/25" : "via-zinc-500/20";
                  const ptBadge = colony.isHarsh ? "bg-red-950/60 text-red-400 border-red-900/40" : isGreen ? "bg-emerald-950/60 text-emerald-500 border-emerald-900/40" : isDesert ? "bg-amber-950/60 text-amber-400 border-amber-900/40" : isFrozen ? "bg-sky-950/60 text-sky-400 border-sky-900/40" : isToxic ? "bg-violet-950/60 text-violet-400 border-violet-900/40" : isGas ? "bg-orange-950/60 text-orange-400 border-orange-900/40" : "bg-zinc-800 text-zinc-400 border-zinc-700";
                  return (
                    <div className={`relative rounded-lg border ${borderCls} bg-gradient-to-br ${gradFrom} via-zinc-900 to-zinc-900 px-4 py-3 overflow-hidden`}>
                      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${accentVia} to-transparent`} />
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-zinc-100">Body {colony.bodyIndex}</span>
                        {colony.planetType && (
                          <span className={`rounded-full px-2 py-0.5 text-xs border ${ptBadge}`}>
                            {BODY_LABELS[colony.planetType] ?? colony.planetType}
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-xs border ${healthBadge}`}>{healthLabel}</span>
                        {colony.status !== "active" && (
                          <span className="rounded-full px-2 py-0.5 text-xs border border-zinc-700 text-zinc-500">{colony.status}</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        Tier {colony.populationTier}
                        {colony.growthLabel && (
                          <span className={`ml-2 ${colony.upkeepMissedPeriods >= 1 ? "text-amber-500" : "text-zinc-600"}`}>
                            · {colony.growthLabel}
                          </span>
                        )}
                      </p>
                      {colony.status === "active" && (
                        <div className="mt-2 max-w-xs">
                          <HealthBar pct={colony.healthPct} health={colony.health} />
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Abandoned banner */}
                {colony.status === "abandoned" && (() => {
                  const windowMs = colony.resolutionWindowDays * 24 * 3_600_000;
                  const abandonedAt = colony.abandonedAt ? new Date(colony.abandonedAt) : new Date();
                  const collapseAt = new Date(abandonedAt.getTime() + windowMs);
                  const msLeft = collapseAt.getTime() - Date.now();
                  const daysLeft = Math.max(0, Math.floor(msLeft / 86_400_000));
                  const hoursLeft = Math.max(0, Math.floor((msLeft % 86_400_000) / 3_600_000));
                  return (
                    <div className="rounded-lg border border-amber-800 bg-amber-950/30 px-4 py-3 space-y-2">
                      <p className="text-sm font-medium text-amber-400">Colony Abandoned</p>
                      {msLeft > 0 ? (
                        <>
                          <p className="text-xs text-zinc-400">
                            Reactivate within{" "}
                            <span className="font-semibold text-amber-300">{daysLeft}d {hoursLeft}h</span>{" "}
                            or it collapses.
                          </p>
                          <button
                            onClick={() => handleReactivate(colony.id)}
                            disabled={reactivateLoading}
                            className="rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors btn-glow-amber"
                          >
                            {reactivateLoading ? "Reactivating…" : "Reactivate Colony"}
                          </button>
                          {reactivateError && <p className="text-xs text-red-400">{reactivateError}</p>}
                        </>
                      ) : (
                        <p className="text-xs text-zinc-500">Reactivation window expired.</p>
                      )}
                    </div>
                  );
                })()}

                {/* Health warning */}
                {colony.status === "active" && colony.health !== "well_supplied" && (
                  <div className={`rounded-lg border px-4 py-3 ${
                    colony.health === "neglected"
                      ? "border-red-900 bg-red-950/30"
                      : "border-amber-900 bg-amber-950/30"
                  }`}>
                    <p className={`text-xs font-medium ${colony.health === "neglected" ? "text-red-400" : "text-amber-400"}`}>
                      {colony.health === "neglected"
                        ? `Neglected (${colony.upkeepMissedPeriods} missed) — send ${colony.isHarsh ? "food + iron" : "food"} immediately`
                        : `Low supply — yields reduced`}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-600">{colony.upkeepDesc}</p>
                  </div>
                )}

                {/* Stockpile */}
                <section className="animate-fade-in-up">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 shrink-0">Stockpile</h3>
                    <div className="flex-1 h-px bg-gradient-to-r from-zinc-800 to-transparent" />
                    <span className="text-xs text-zinc-700 shrink-0">
                      {colony.inventoryTotal > 0 ? `${colony.inventoryTotal.toLocaleString()} u` : "empty"}
                    </span>
                  </div>
                  {colony.inventory.length > 0 ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                      {colony.inventory.map((r) => (
                        <div key={r.resourceType} className="flex items-center justify-between">
                          <span className="text-xs text-zinc-500 capitalize">{r.resourceType.replace(/_/g, " ")}</span>
                          <span className="font-mono text-sm font-medium text-zinc-200">{r.quantity.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-center">
                      <p className="text-xs text-zinc-600">
                        Stockpile empty.
                        {colony.basicNodeCount > 0 && colony.totalRatePerHr > 0 && (
                          <span className="ml-1">Accruing at {colony.totalRatePerHr} u/hr.</span>
                        )}
                      </p>
                    </div>
                  )}
                </section>

                {/* Output + Tax */}
                {colony.status === "active" && (
                  <section className="animate-fade-in-up">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 shrink-0">Output</h3>
                      <div className="flex-1 h-px bg-gradient-to-r from-zinc-800 to-transparent" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 card-interactive">
                        <p className="text-xs text-zinc-600">Production</p>
                        <p className="mt-1 text-sm font-medium text-teal-300">
                          {colony.totalRatePerHr > 0 ? `${colony.totalRatePerHr} u/hr` : <span className="text-zinc-500">Paused</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-700">
                          {colony.basicNodeCount} node{colony.basicNodeCount !== 1 ? "s" : ""}
                          {colony.extractorTier > 0 && ` · T${colony.extractorTier} extractor`}
                        </p>
                        {colony.isCapped && (
                          <p className="mt-1 text-xs text-amber-500">Cap reached — haul soon</p>
                        )}
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 card-interactive">
                        <p className="text-xs text-zinc-600">Tax accrued</p>
                        {colony.accruedTax > 0 ? (
                          <>
                            <p className="mt-1 font-mono text-lg font-semibold text-amber-300">{colony.accruedTax} ¢</p>
                            <div className="mt-1.5">
                              <button
                                onClick={() => handleCollect(colony.id)}
                                disabled={collectLoading}
                                className="rounded bg-amber-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors btn-glow-amber"
                              >
                                {collectLoading ? "Collecting…" : `Collect ${colony.accruedTax} ¢`}
                              </button>
                            </div>
                            {collectError && <p className="mt-1 text-xs text-red-400">{collectError}</p>}
                          </>
                        ) : (
                          <p className="mt-1 text-sm text-zinc-500">None yet</p>
                        )}
                      </div>
                    </div>
                  </section>
                )}

                {/* Structures */}
                {colony.status === "active" && (
                  <section className="animate-fade-in-up">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 shrink-0">Structures</h3>
                      <div className="flex-1 h-px bg-gradient-to-r from-zinc-800 to-transparent" />
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 space-y-3">
                      {colony.buildOptions.map((opt) => (
                        <div key={opt.type} className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-zinc-300">
                              {STRUCT_LABELS[opt.type] ?? opt.type}
                              {opt.currentTier > 0 && (
                                <span className="ml-1.5 text-zinc-600">T{opt.currentTier}</span>
                              )}
                            </p>
                            <p className="text-xs text-zinc-600">{STRUCT_DESC[opt.type]}</p>
                          </div>
                          <div className="shrink-0">
                            {opt.atMax ? (
                              <span className="text-xs text-zinc-700">Max</span>
                            ) : opt.cost ? (
                              <button
                                onClick={() => handleBuild(colony.id, opt.type)}
                                disabled={buildLoading === opt.type || !opt.canAfford}
                                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                                  opt.canAfford && buildLoading !== opt.type
                                    ? "bg-teal-900/60 text-teal-300 hover:bg-teal-800/60"
                                    : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                                } disabled:opacity-60`}
                              >
                                {buildLoading === opt.type
                                  ? "Building…"
                                  : `${opt.currentTier === 0 ? "Build" : "Upgrade"} T${opt.targetTier} · ${opt.cost.iron}⛏`}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                      {buildError && <p className="text-xs text-red-400">{buildError}</p>}
                    </div>
                  </section>
                )}

                {/* Emergency Supply */}
                {colony.status === "active" && colony.health !== "well_supplied" && (
                  <section className="animate-fade-in-up">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 shrink-0">Emergency Supply</h3>
                      <div className="flex-1 h-px bg-gradient-to-r from-zinc-800 to-transparent" />
                    </div>
                    <div className="rounded-lg border border-orange-900/50 bg-orange-950/20 px-4 py-3 space-y-2">
                      <p className="text-xs text-zinc-500">
                        Instant delivery · {colony.euxDailyUsed}/{colony.euxDailyLimit} daily limit used
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={euxResource}
                          onChange={(e) => setEuxResource(e.target.value as "iron" | "carbon" | "ice")}
                          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 focus:border-orange-600 focus:outline-none"
                        >
                          {colony.euxOptions.map((o) => (
                            <option key={o.resourceType} value={o.resourceType}>
                              {o.resourceType} ({o.pricePerUnit} ¢/u)
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          max={Math.min(euxRemaining, 500)}
                          value={euxQty}
                          onChange={(e) => setEuxQty(Math.max(1, Math.min(euxRemaining, Number(e.target.value) || 1)))}
                          className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-center text-xs text-zinc-200 focus:outline-none"
                        />
                        <button
                          onClick={() => handleEuxBuy(colony.id)}
                          disabled={euxLoading || !euxCanBuy}
                          className="rounded border border-orange-800/60 bg-orange-950/40 px-3 py-1 text-xs font-medium text-orange-300 hover:bg-orange-900/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                        >
                          {euxLoading ? "Buying…" : `Buy (${euxTotalCost.toLocaleString()} ¢)`}
                        </button>
                      </div>
                      {euxError && <p className="text-xs text-red-400">{euxError}</p>}
                    </div>
                  </section>
                )}

                {/* Ships in system */}
                {colony.shipsInSystem.length > 0 && (
                  <section className="animate-fade-in-up">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
                        Ships in System ({colony.shipsInSystem.length})
                      </h3>
                      <div className="flex-1 h-px bg-gradient-to-r from-zinc-800 to-transparent" />
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 space-y-1.5">
                      {colony.shipsInSystem.map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-zinc-300">{s.name}</span>
                          <div className="flex items-center gap-2">
                            {s.isAssigned && (
                              <span className="text-xs text-indigo-500">assigned</span>
                            )}
                            <span className="text-xs text-zinc-600">{s.cargoCap.toLocaleString()} cap</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
