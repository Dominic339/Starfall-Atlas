"use client";

/**
 * EmpireMapPanel — combines Research (tech tree) and World Feed into one panel.
 * Replaces having two separate top-bar buttons.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

// ---------------------------------------------------------------------------
// ── FEED TAB ────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

interface FeedEvent {
  id: string; eventType: string; label: string;
  playerHandle: string | null; systemName: string | null;
  occurredAt: string;
}

const EVENT_COLOR: Record<string, string> = {
  system_discovered: "text-indigo-400",   colony_founded:    "text-emerald-400",
  colony_abandoned:  "text-amber-400",    colony_collapsed:  "text-red-400",
  colony_reactivated:"text-emerald-300",  colony_sold:       "text-orange-400",
  system_sold:       "text-orange-400",   alliance_formed:   "text-violet-400",
  alliance_dissolved:"text-zinc-400",     lane_built:        "text-sky-400",
  gate_built:        "text-sky-300",      gate_neutralized:  "text-amber-500",
  gate_reclaimed:    "text-emerald-500",  stewardship_registered: "text-teal-400",
  majority_control_gained: "text-rose-400",
};

function FeedTab() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/game/feed?limit=50")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setEvents(json.data.events as FeedEvent[]);
          setHasMore((json.data.events as FeedEvent[]).length === 50);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    const oldest = events[events.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/game/feed?limit=50&before=${encodeURIComponent(oldest.occurredAt)}`);
      const json = await res.json();
      if (json.ok) {
        const next = json.data.events as FeedEvent[];
        setEvents((prev) => [...prev, ...next]);
        setHasMore(next.length === 50);
      }
    } catch {}
    finally { setLoadingMore(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><p className="text-xs text-zinc-600 animate-pulse uppercase tracking-widest">Loading…</p></div>;
  if (events.length === 0) return <p className="text-sm text-zinc-600 text-center py-12">No events yet.</p>;

  return (
    <div>
      {events.map((e) => {
        const color = EVENT_COLOR[e.eventType] ?? "text-zinc-500";
        return (
          <div key={e.id} className="flex items-start gap-3 py-2.5 border-b border-zinc-800/50 last:border-0">
            <span className={`mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full bg-current ${color}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-400">
                {e.playerHandle && <span className="font-semibold text-zinc-200">{e.playerHandle} </span>}
                <span className={color}>{e.label}</span>
                {e.systemName && <span className="text-zinc-600"> · {e.systemName}</span>}
              </p>
            </div>
            <span className="shrink-0 text-[10px] text-zinc-700">{timeAgo(e.occurredAt)}</span>
          </div>
        );
      })}
      {hasMore && (
        <button
          onClick={loadMore} disabled={loadingMore}
          className="mt-3 w-full py-2 text-xs text-zinc-600 hover:text-zinc-300 disabled:opacity-50 transition-colors border border-zinc-800 rounded-lg"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ── RESEARCH TAB ────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

interface ResearchItem {
  id: string; name: string; description: string;
  tierLabel: string; costLabel: string;
  status: "unlocked" | "purchasable" | "locked";
  canAfford: boolean; prereqsMet: boolean; milestonesMet: boolean;
  blockingPrereqNames: string[]; blockingMilestoneLabels: string[];
  scaffoldOnly: boolean;
}
interface SubGroup { id: string; label: string; items: ResearchItem[]; }
interface Category {
  id: string; label: string;
  unlockedCount: number; totalCount: number;
  subGroups: SubGroup[];
}
interface ResearchData {
  categories: Category[];
  stationIron: number;
  totalUpgradeCap: number;
  maxTotalUpgrades: number;
  statCaps: Record<string, number>;
}

const STAT_KEYS = ["hull", "shield", "cargo", "engine", "turret", "utility"] as const;

function ResearchCard({
  item, onPurchase, purchaseLoading,
}: { item: ResearchItem; onPurchase: (id: string) => void; purchaseLoading: string | null }) {
  const isUnlocked    = item.status === "unlocked";
  const isPurchasable = item.status === "purchasable" && !item.scaffoldOnly;
  const isReady       = isPurchasable && item.canAfford;
  const isScaffold    = item.scaffoldOnly;

  return (
    <div className={`flex flex-col rounded-xl border px-3 py-2.5 gap-2 min-w-[150px] flex-1 ${
      isUnlocked  ? "border-emerald-800/60 bg-emerald-950/15" :
      isReady     ? "border-indigo-700/80 bg-indigo-950/20" :
      isPurchasable ? "border-amber-800/40 bg-zinc-900" :
      isScaffold  ? "border-zinc-800/30 bg-zinc-900/10" :
                    "border-zinc-800 bg-zinc-900/40"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-xs font-semibold leading-snug ${
          isUnlocked ? "text-emerald-300" : isReady ? "text-zinc-100" :
          isPurchasable ? "text-zinc-300" : "text-zinc-600"
        }`}>{item.name}</p>
        {item.tierLabel && (
          <span className={`shrink-0 rounded text-[10px] font-mono px-1.5 py-0.5 ${
            isUnlocked ? "bg-emerald-900/60 text-emerald-400" :
            isReady ? "bg-indigo-900/60 text-indigo-300" : "bg-zinc-800 text-zinc-600"
          }`}>{item.tierLabel}</span>
        )}
      </div>

      <p className={`text-xs leading-relaxed flex-1 ${
        isScaffold ? "text-zinc-700 italic" :
        isUnlocked ? "text-emerald-200/70" :
        isReady ? "text-zinc-300" : "text-zinc-600"
      }`}>
        {isScaffold ? "Not yet available." : item.description}
      </p>

      <div className="flex items-end justify-between gap-2">
        <div className="text-[10px] min-w-0 flex-1">
          {!item.scaffoldOnly && item.status === "locked" && !item.prereqsMet && (
            <p className="text-amber-700">Needs: {item.blockingPrereqNames.join(", ")}</p>
          )}
          {!item.scaffoldOnly && item.status === "locked" && item.prereqsMet && !item.milestonesMet && (
            <p className="text-amber-700">{item.blockingMilestoneLabels.join(", ")}</p>
          )}
          {isPurchasable && !item.canAfford && (
            <p className="text-amber-600">{item.costLabel}</p>
          )}
        </div>
        {isUnlocked ? (
          <span className="text-[10px] text-emerald-500 font-bold shrink-0">✓</span>
        ) : isScaffold ? (
          <span className="text-[10px] text-zinc-700 font-mono">Soon</span>
        ) : isPurchasable ? (
          <button
            onClick={() => onPurchase(item.id)}
            disabled={!item.canAfford || purchaseLoading === item.id}
            className={`shrink-0 rounded px-2.5 py-1 text-[10px] font-bold transition-colors ${
              !item.canAfford ? "bg-zinc-800 text-zinc-600 cursor-not-allowed" :
              purchaseLoading === item.id ? "bg-indigo-800 text-indigo-300 opacity-60 cursor-wait" :
              "bg-indigo-600 hover:bg-indigo-500 text-white"
            }`}
          >
            {purchaseLoading === item.id ? "…" : "Research"}
          </button>
        ) : (
          <span className="text-[10px] text-zinc-600">{item.costLabel}</span>
        )}
      </div>
    </div>
  );
}

function ResearchTab() {
  const router = useRouter();
  const [data, setData] = useState<ResearchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState(0);
  const [purchaseLoading, setPurchaseLoading] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/game/research/panel");
      const json = await res.json();
      if (json.ok) setData(json.data as ResearchData);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function handlePurchase(researchId: string) {
    setPurchaseLoading(researchId); setPurchaseError(null);
    try {
      const res = await fetch("/api/game/research/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researchId }),
      });
      const json = await res.json();
      if (!json.ok) setPurchaseError(json.error?.message ?? "Failed.");
      else { setRefreshKey((k) => k + 1); router.refresh(); }
    } catch { setPurchaseError("Network error."); }
    finally { setPurchaseLoading(null); }
  }

  if (loading) return <div className="flex justify-center py-12"><p className="text-xs text-zinc-600 animate-pulse uppercase tracking-widest">Loading…</p></div>;
  if (!data) return null;

  const cat = data.categories[activeCat] ?? null;

  return (
    <div className="space-y-4">
      {/* Progression summary */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-600">Station iron:</span>
            <span className="font-mono text-xs text-orange-400">{data.stationIron.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-600">Upgrade budget:</span>
            <span className="font-mono text-xs text-zinc-300">{data.totalUpgradeCap}</span>
            <span className="text-[10px] text-zinc-700">/ {data.maxTotalUpgrades}</span>
            <div className="w-16 h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-indigo-600"
                style={{ width: `${Math.round((data.totalUpgradeCap / data.maxTotalUpgrades) * 100)}%` }} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-zinc-600">Stat caps:</span>
          {STAT_KEYS.map((s) => (
            <span key={s} className="text-[10px] font-mono bg-zinc-800/60 px-1.5 py-0.5 rounded text-zinc-400">
              {s.slice(0,3).toUpperCase()} {data.statCaps[s] ?? 2}
            </span>
          ))}
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 flex-wrap">
        {data.categories.map((c, i) => (
          <button key={c.id} onClick={() => setActiveCat(i)}
            className={`px-3 py-1 text-[10px] font-medium rounded-full transition-colors ${
              i === activeCat ? "bg-indigo-900/60 text-indigo-300 border border-indigo-800/50" : "text-zinc-600 hover:text-zinc-400 border border-zinc-800"
            }`}
          >
            {c.label} <span className="text-zinc-600">{c.unlockedCount}/{c.totalCount}</span>
          </button>
        ))}
      </div>

      {purchaseError && <p className="text-xs text-red-400">{purchaseError}</p>}

      {cat && cat.subGroups.map((sg) => (
        <div key={sg.id}>
          {cat.subGroups.length > 1 && sg.label && (
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">{sg.label}</p>
          )}
          <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
            {sg.items.map((item, idx) => (
              <div key={item.id} className="flex items-stretch shrink-0">
                <ResearchCard item={item} onPurchase={handlePurchase} purchaseLoading={purchaseLoading} />
                {idx < sg.items.length - 1 && (
                  <div className="flex items-center px-1 shrink-0 self-center">
                    <span className="text-zinc-700 text-xs select-none">→</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ── MAIN PANEL ──────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

interface EmpireMapPanelProps { onClose: () => void; }

export function EmpireMapPanel({ onClose }: EmpireMapPanelProps) {
  const [tab, setTab] = useState<"research" | "feed">("research");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-zinc-700/80 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden">

        {/* Header */}
        <div className="shrink-0 border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-950 px-5 py-3.5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-zinc-100">Empire</h2>
            <p className="mt-0.5 text-[10px] text-zinc-600">Research and galactic events</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex border-b border-zinc-800 px-4 pt-2 gap-1">
          {([
            { id: "research", label: "Research" },
            { id: "feed",     label: "World Feed" },
          ] as const).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                tab === t.id ? "bg-zinc-800 text-zinc-200 border-b-2 border-indigo-600" : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "research" && <ResearchTab />}
          {tab === "feed"     && <FeedTab />}
        </div>
      </div>
    </div>
  );
}
