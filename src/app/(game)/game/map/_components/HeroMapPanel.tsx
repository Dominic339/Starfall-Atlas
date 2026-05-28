"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  HERO_CLASS_LABELS,
  HERO_CLASS_DESCRIPTIONS,
  XP_FOR_LEVEL,
  levelForXp,
  xpToNextLevel,
  heroBonusesForClass,
  type HeroClass,
} from "@/lib/game/heroShip";

const HERO_CLASSES: HeroClass[] = ["pathfinder", "warlord", "merchant", "industrialist", "engineer", "raider"];

const CLASS_COLOR: Record<HeroClass, string> = {
  pathfinder:    "text-sky-400",
  warlord:       "text-red-400",
  merchant:      "text-amber-400",
  industrialist: "text-emerald-400",
  engineer:      "text-violet-400",
  raider:        "text-orange-400",
};

const CLASS_ICON: Record<HeroClass, string> = {
  pathfinder:    "◈",
  warlord:       "⚔",
  merchant:      "◎",
  industrialist: "⬡",
  engineer:      "⚙",
  raider:        "◆",
};

interface HeroData {
  shipId: string;
  shipName: string;
  heroClass: HeroClass;
  heroLevel: number;
  heroXp: number;
}

interface HeroMapPanelProps {
  onClose: () => void;
}

function BonusList({ heroClass, level }: { heroClass: HeroClass; level: number }) {
  const b = heroBonusesForClass(heroClass, level);
  const lines: string[] = [];
  if (b.travelSpeedBonusLyHr > 0)         lines.push(`+${b.travelSpeedBonusLyHr.toFixed(0)} ly/hr travel speed`);
  if (b.laneRangeBonusLy > 0)              lines.push(`+${b.laneRangeBonusLy} ly lane range`);
  if (b.disputeScoreMultiplier > 0)        lines.push(`+${Math.round(b.disputeScoreMultiplier * 100)}% dispute score`);
  if (b.marketFeePercent < 2)              lines.push(`${b.marketFeePercent}% market listing fee (vs 2%)`);
  if (b.transitTaxBonusFraction > 0)       lines.push(`+${Math.round(b.transitTaxBonusFraction * 100)}% transit tax income`);
  if (b.extractionMultiplierBonus > 0)     lines.push(`+${Math.round(b.extractionMultiplierBonus * 100)}% extraction rate`);
  if (b.constructionTimeMultiplier < 1)    lines.push(`${Math.round((1 - b.constructionTimeMultiplier) * 100)}% faster construction`);
  if (b.structureCostMultiplier < 1)       lines.push(`${Math.round((1 - b.structureCostMultiplier) * 100)}% cheaper structures`);
  if (b.harvestPowerBonusFraction > 0)     lines.push(`+${Math.round(b.harvestPowerBonusFraction * 100)}% asteroid harvest power`);
  return (
    <ul className="space-y-1">
      {lines.map((l) => (
        <li key={l} className="flex items-start gap-1.5 text-xs text-zinc-400">
          <span className="text-emerald-500 mt-px shrink-0">✓</span>{l}
        </li>
      ))}
    </ul>
  );
}

export function HeroMapPanel({ onClose }: HeroMapPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<HeroData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [pending, setPending] = useState<HeroClass | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/game/hero/panel")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setData(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSelectClass(heroClass: HeroClass) {
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/game/hero/set-class", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heroClass }),
      });
      const json = await res.json();
      if (json.ok) {
        setData((d) => d ? { ...d, heroClass } : d);
        setSelecting(false);
        router.refresh();
      } else {
        setError(json.error?.message ?? "Failed to set class.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  const xpForCurrent = data ? XP_FOR_LEVEL[data.heroLevel - 1] ?? 0 : 0;
  const xpForNext    = data ? (XP_FOR_LEVEL[data.heroLevel] ?? null) : null;
  const xpInLevel    = data ? data.heroXp - xpForCurrent : 0;
  const xpNeeded     = xpForNext !== null ? xpForNext - xpForCurrent : null;
  const xpPct        = xpNeeded ? Math.min(100, Math.round((xpInLevel / xpNeeded) * 100)) : 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="relative w-full max-w-sm max-h-[90vh] flex flex-col rounded-xl border border-zinc-700/80 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden animate-fade-in-up">

        {/* Header */}
        <div className="shrink-0 border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-950 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Commander</p>
            {loading ? (
              <div className="w-32 h-5 rounded bg-zinc-800 animate-pulse mt-1" />
            ) : (
              <p className="text-sm font-bold text-zinc-100">{data?.shipName ?? "—"}</p>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && (
            <div className="flex justify-center py-10">
              <p className="text-xs text-zinc-600 animate-pulse uppercase tracking-widest">Loading…</p>
            </div>
          )}

          {!loading && data && !selecting && (
            <>
              {/* Class badge + level */}
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl border flex items-center justify-center text-xl shrink-0 ${CLASS_COLOR[data.heroClass]} border-current/30 bg-zinc-900/60`}>
                  {CLASS_ICON[data.heroClass]}
                </div>
                <div className="min-w-0">
                  <p className={`text-base font-bold ${CLASS_COLOR[data.heroClass]}`}>
                    {HERO_CLASS_LABELS[data.heroClass]}
                  </p>
                  <p className="text-xs text-zinc-500">Level {data.heroLevel}</p>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-zinc-500 leading-relaxed">{HERO_CLASS_DESCRIPTIONS[data.heroClass]}</p>

              {/* Bonuses */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Active Bonuses</p>
                <BonusList heroClass={data.heroClass} level={data.heroLevel} />
              </div>

              {/* XP bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Commander XP</p>
                  {data.heroLevel < 20 ? (
                    <p className="text-[10px] text-zinc-600">{xpInLevel.toLocaleString()} / {xpNeeded?.toLocaleString()} to L{data.heroLevel + 1}</p>
                  ) : (
                    <p className="text-[10px] text-emerald-500">Max Level</p>
                  )}
                </div>
                <div className="h-2 rounded-full bg-zinc-800/80 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-500"
                    style={{ width: `${xpPct}%` }}
                  />
                </div>
                <p className="text-[10px] text-zinc-700">{data.heroXp.toLocaleString()} total XP</p>
              </div>

              {/* Change class (only if no XP earned yet) */}
              {data.heroXp === 0 && (
                <button
                  onClick={() => setSelecting(true)}
                  className="w-full rounded-lg border border-zinc-700/50 bg-zinc-900/40 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors"
                >
                  Choose Class
                </button>
              )}
            </>
          )}

          {/* Class selection screen */}
          {!loading && data && selecting && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">Choose your commander class. This cannot be changed once XP is earned.</p>
              {error && <p className="text-xs text-red-400">{error}</p>}
              {HERO_CLASSES.map((cls) => (
                <button
                  key={cls}
                  onClick={() => { if (!saving) handleSelectClass(cls); }}
                  disabled={saving}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                    pending === cls
                      ? `border-current/60 bg-zinc-800/60 ${CLASS_COLOR[cls]}`
                      : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                  }`}
                  onMouseEnter={() => setPending(cls)}
                  onMouseLeave={() => setPending(null)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-lg ${CLASS_COLOR[cls]}`}>{CLASS_ICON[cls]}</span>
                    <div>
                      <p className={`text-sm font-bold ${CLASS_COLOR[cls]}`}>{HERO_CLASS_LABELS[cls]}</p>
                      <p className="text-[10px] text-zinc-600">{HERO_CLASS_DESCRIPTIONS[cls]}</p>
                    </div>
                  </div>
                </button>
              ))}
              <button onClick={() => setSelecting(false)} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
