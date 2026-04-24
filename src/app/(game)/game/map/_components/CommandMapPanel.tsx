"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShipStatKey = "hull" | "shield" | "cargo" | "engine" | "turret" | "utility";

interface StatState {
  currentLevel: number;
  researchCap: number;
  isAtStatCap: boolean;
  isAtTotalCap: boolean;
  canUpgrade: boolean;
  ironCost: number;
}

interface ShipData {
  id: string;
  name: string;
  tier: number;
  totalUpgrades: number;
  maxTotalUpgrades: number;
  effectiveCargoCap: number;
  effectiveSpeed: number;
  isDockedAtStation: boolean;
  isTraveling: boolean;
  currentSystemName: string | null;
  stats: Record<ShipStatKey, StatState>;
}

interface PanelData {
  ships: ShipData[];
  stationIron: number;
  hasStation: boolean;
}

interface CommandMapPanelProps { onClose: () => void; }

// ---------------------------------------------------------------------------
// Visual config
// ---------------------------------------------------------------------------

const STAT_META: Record<ShipStatKey, { label: string; desc: string; color: string; track: string; fill: string }> = {
  hull:    { label: "Hull",    desc: "Armor integrity",   color: "text-orange-400",  track: "bg-orange-950/40",  fill: "bg-orange-500" },
  shield:  { label: "Shield",  desc: "Energy barrier",    color: "text-sky-400",     track: "bg-sky-950/40",     fill: "bg-sky-500" },
  cargo:   { label: "Cargo",   desc: "+50 cap/level",     color: "text-teal-400",    track: "bg-teal-950/40",    fill: "bg-teal-500" },
  engine:  { label: "Engine",  desc: "+1 ly/hr per level",color: "text-cyan-400",    track: "bg-cyan-950/40",    fill: "bg-cyan-500" },
  turret:  { label: "Turret",  desc: "Weapons payload",   color: "text-rose-400",    track: "bg-rose-950/40",    fill: "bg-rose-500" },
  utility: { label: "Utility", desc: "Support systems",   color: "text-violet-400",  track: "bg-violet-950/40",  fill: "bg-violet-500" },
};

const TIER_STYLE: Record<number, { label: string; border: string; bg: string; text: string }> = {
  1: { label: "T1", border: "border-zinc-700",    bg: "bg-zinc-800/60",    text: "text-zinc-400" },
  2: { label: "T2", border: "border-teal-700/60", bg: "bg-teal-950/40",   text: "text-teal-400" },
  3: { label: "T3", border: "border-indigo-700/60",bg: "bg-indigo-950/40",text: "text-indigo-400" },
  4: { label: "T4", border: "border-violet-700/60",bg: "bg-violet-950/40",text: "text-violet-400" },
  5: { label: "T5", border: "border-amber-700/60", bg: "bg-amber-950/40", text: "text-amber-400" },
};

function tierStyle(t: number) { return TIER_STYLE[t] ?? TIER_STYLE[1]; }

// ---------------------------------------------------------------------------
// StatRow
// ---------------------------------------------------------------------------

function StatRow({
  stat, state, stationIron, shipId,
  upgradeLoading, onUpgrade,
}: {
  stat: ShipStatKey;
  state: StatState;
  stationIron: number;
  shipId: string;
  upgradeLoading: string | null;
  onUpgrade: (shipId: string, stat: ShipStatKey) => void;
}) {
  const meta = STAT_META[stat];
  const canAfford = stationIron >= state.ironCost;
  const loadingKey = `${shipId}:${stat}`;

  return (
    <div className="flex items-center gap-3">
      {/* Stat label */}
      <div className="w-14 shrink-0">
        <p className={`text-[10px] font-bold uppercase tracking-widest ${meta.color}`}>{meta.label}</p>
      </div>

      {/* Level pips */}
      <div className="flex items-center gap-0.5 shrink-0">
        {Array.from({ length: state.researchCap }).map((_, i) => (
          <span
            key={i}
            className={`w-2.5 h-2.5 rounded-sm transition-colors ${
              i < state.currentLevel
                ? meta.fill
                : meta.track
            }`}
          />
        ))}
      </div>

      {/* Level text */}
      <span className="text-xs text-zinc-600 font-mono shrink-0 w-8">
        {state.currentLevel}/{state.researchCap}
      </span>

      {/* Cost or status */}
      <div className="flex-1 min-w-0 flex items-center justify-end gap-2">
        {state.isAtStatCap || (state.isAtTotalCap && !state.isAtStatCap) ? (
          <span className={`text-[10px] font-medium ${state.isAtStatCap ? "text-zinc-600" : "text-amber-700"}`}>
            {state.isAtStatCap ? "Maxed" : "Budget cap"}
          </span>
        ) : (
          <>
            <span className="text-[10px] text-zinc-600 font-mono">
              {state.ironCost.toLocaleString()} Fe
            </span>
            <button
              onClick={() => onUpgrade(shipId, stat)}
              disabled={!state.canUpgrade || !canAfford || upgradeLoading === loadingKey}
              className={`rounded px-2.5 py-1 text-[10px] font-bold transition-all ${
                !state.canUpgrade || !canAfford
                  ? "bg-zinc-800/60 text-zinc-600 cursor-not-allowed"
                  : upgradeLoading === loadingKey
                    ? `${meta.track} ${meta.color} opacity-60 cursor-wait`
                    : `${meta.track} ${meta.color} hover:brightness-150 border ${meta.fill.replace("bg-", "border-")}/30`
              }`}
            >
              {upgradeLoading === loadingKey ? "…" : "↑"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShipCard
// ---------------------------------------------------------------------------

function ShipCard({
  ship, stationIron,
  upgradeLoading, upgradeError,
  onUpgrade,
}: {
  ship: ShipData;
  stationIron: number;
  upgradeLoading: string | null;
  upgradeError: { shipId: string; text: string } | null;
  onUpgrade: (shipId: string, stat: ShipStatKey) => void;
}) {
  const ts = tierStyle(ship.tier);
  const budgetPct = ship.maxTotalUpgrades > 0
    ? Math.round((ship.totalUpgrades / ship.maxTotalUpgrades) * 100)
    : 0;
  const err = upgradeError?.shipId === ship.id ? upgradeError.text : null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">

      {/* Ship header */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 bg-gradient-to-r from-zinc-900/80 to-zinc-950/60">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-zinc-200">{ship.name}</h3>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${ts.border} ${ts.bg} ${ts.text}`}>
              {ts.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-zinc-600">
            <span>{ship.effectiveSpeed.toFixed(1)} ly/hr</span>
            <span className="text-zinc-800">·</span>
            <span>{ship.effectiveCargoCap} cargo</span>
            <span className="text-zinc-800">·</span>
            <span className={ship.isTraveling ? "text-sky-600" : ship.isDockedAtStation ? "text-emerald-600" : "text-indigo-600"}>
              {ship.isTraveling ? "In transit" : ship.currentSystemName ?? "Unknown"}
            </span>
          </div>
        </div>

        {/* Budget bar */}
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-zinc-600 mb-1">
            <span className="font-mono text-zinc-400">{ship.totalUpgrades}</span>
            <span className="text-zinc-700">/{ship.maxTotalUpgrades}</span>
          </p>
          <div className="w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                budgetPct >= 100 ? "bg-amber-600" :
                budgetPct >= 70  ? "bg-indigo-500" : "bg-teal-600"
              }`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="px-4 py-3 space-y-2.5">
        {(Object.keys(STAT_META) as ShipStatKey[]).map((stat) => (
          <StatRow
            key={stat}
            stat={stat}
            state={ship.stats[stat]}
            stationIron={stationIron}
            shipId={ship.id}
            upgradeLoading={upgradeLoading}
            onUpgrade={onUpgrade}
          />
        ))}
      </div>

      {err && (
        <div className="border-t border-zinc-800/60 px-4 py-2 text-xs text-red-400">{err}</div>
      )}

      {!ship.isDockedAtStation && !ship.isTraveling && (
        <div className="border-t border-zinc-800/60 px-4 py-2 text-[10px] text-zinc-700">
          Ship must be docked at station to upgrade.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function CommandMapPanel({ onClose }: CommandMapPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [upgradeLoading, setUpgradeLoading] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] = useState<{ shipId: string; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/game/command/panel");
      const json = await res.json();
      if (json.ok) setData(json.data as PanelData);
      else setError(json.error?.message ?? "Failed to load.");
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function handleUpgrade(shipId: string, stat: ShipStatKey) {
    setUpgradeLoading(`${shipId}:${stat}`);
    setUpgradeError(null);
    try {
      const res = await fetch("/api/game/ship/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipId, stat }),
      });
      const json = await res.json();
      if (!json.ok) {
        setUpgradeError({ shipId, text: json.error?.message ?? "Upgrade failed." });
      } else {
        setRefreshKey((k) => k + 1);
        router.refresh();
      }
    } catch {
      setUpgradeError({ shipId, text: "Network error." });
    } finally {
      setUpgradeLoading(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-zinc-700/80 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden">

        {/* Header */}
        <div className="shrink-0 border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-950 px-5 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Ship Command</h2>
              {data && (
                <div className="flex items-center gap-3 mt-0.5 text-[10px]">
                  <span className="text-zinc-600">
                    Station iron:{" "}
                    <span className="font-mono text-orange-400">{data.stationIron.toLocaleString()}</span>
                    <span className="text-zinc-700"> Fe</span>
                  </span>
                  <span className="text-zinc-700">·</span>
                  <span className="text-zinc-600">
                    {data.ships.length} {data.ships.length === 1 ? "ship" : "ships"}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none"
            >✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <p className="text-xs text-zinc-600 uppercase tracking-widest animate-pulse">Loading…</p>
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-400 text-center">
              {error}
            </div>
          )}
          {!loading && !error && data && data.ships.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm text-zinc-600">No ships found.</p>
            </div>
          )}
          {!loading && !error && data && data.ships.map((ship) => (
            <ShipCard
              key={ship.id}
              ship={ship}
              stationIron={data.stationIron}
              upgradeLoading={upgradeLoading}
              upgradeError={upgradeError}
              onUpgrade={handleUpgrade}
            />
          ))}

          {!loading && !error && data && !data.hasStation && (
            <p className="text-xs text-zinc-700 text-center">No station found — upgrades require a station.</p>
          )}
        </div>
      </div>
    </div>
  );
}
