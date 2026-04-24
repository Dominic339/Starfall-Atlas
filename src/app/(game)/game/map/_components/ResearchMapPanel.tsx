"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResearchItem {
  id: string;
  name: string;
  description: string;
  tierLabel: string;
  costLabel: string;
  status: "unlocked" | "purchasable" | "locked";
  canAfford: boolean;
  prereqsMet: boolean;
  milestonesMet: boolean;
  blockingPrereqNames: string[];
  blockingMilestoneLabels: string[];
  scaffoldOnly: boolean;
}

interface SubGroup { id: string; label: string; items: ResearchItem[]; }
interface Category { id: string; label: string; unlockedCount: number; totalCount: number; subGroups: SubGroup[]; }

interface PanelData {
  categories: Category[];
  stationIron: number;
  totalUpgradeCap: number;
  maxTotalUpgrades: number;
  statCaps: Record<string, number>;
}

interface ResearchMapPanelProps { onClose: () => void; }

const STAT_KEYS = ["hull", "shield", "cargo", "engine", "turret", "utility"] as const;

// ---------------------------------------------------------------------------
// Research card
// ---------------------------------------------------------------------------

function ItemCard({
  item,
  onPurchase,
  purchaseLoading,
}: {
  item: ResearchItem;
  onPurchase: (id: string) => void;
  purchaseLoading: string | null;
}) {
  const isUnlocked    = item.status === "unlocked";
  const isPurchasable = item.status === "purchasable" && !item.scaffoldOnly;
  const isReady       = isPurchasable && item.canAfford;
  const isScaffold    = item.scaffoldOnly;

  const cardCls = isUnlocked
    ? "border-emerald-800 bg-emerald-950/20"
    : isReady
      ? "border-indigo-700/80 bg-indigo-950/20"
      : isPurchasable
        ? "border-amber-800/40 bg-zinc-900"
        : isScaffold
          ? "border-zinc-800/40 bg-zinc-900/20"
          : "border-zinc-800 bg-zinc-900/40";

  const nameCls = isUnlocked ? "text-emerald-300" : isReady ? "text-zinc-100" :
    isPurchasable ? "text-zinc-300" : isScaffold ? "text-zinc-600" : "text-zinc-500";

  const tierCls = isUnlocked ? "bg-emerald-900/60 text-emerald-400" :
    isReady ? "bg-indigo-900/60 text-indigo-300" : "bg-zinc-800 text-zinc-500";

  return (
    <div className={`flex flex-col rounded-lg border px-3 py-2.5 gap-2 min-w-[160px] flex-1 ${cardCls}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <p className={`text-xs font-semibold leading-snug ${nameCls}`}>{item.name}</p>
        {item.tierLabel && (
          <span className={`shrink-0 rounded text-xs font-mono px-1.5 py-0.5 leading-none ${tierCls}`}>
            {item.tierLabel}
          </span>
        )}
      </div>

      {/* Description */}
      <div className={`rounded px-2 py-1.5 flex-1 ${
        isScaffold ? "bg-zinc-800/20" : isUnlocked ? "bg-emerald-950/40" :
        isReady ? "bg-indigo-950/40" : "bg-zinc-800/20"
      }`}>
        <p className={`text-xs leading-relaxed ${
          isScaffold ? "text-zinc-600 italic" : isUnlocked ? "text-emerald-200/80" :
          isReady ? "text-amber-200/90 font-medium" : isPurchasable ? "text-zinc-400" : "text-zinc-600"
        }`}>
          {isScaffold ? "Not yet available." : item.description}
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1 text-xs">
          {!item.scaffoldOnly && item.status === "locked" && !item.prereqsMet && (
            <p className="text-amber-600/90">Requires: <span className="font-medium">{item.blockingPrereqNames.join(", ")}</span></p>
          )}
          {!item.scaffoldOnly && item.status === "locked" && item.prereqsMet && !item.milestonesMet && (
            <p className="text-amber-600/90">Needs: <span className="font-medium">{item.blockingMilestoneLabels.join(", ")}</span></p>
          )}
          {isPurchasable && !item.canAfford && (
            <p className="text-amber-500/90">Need <span className="font-medium text-amber-400">{item.costLabel}</span></p>
          )}
        </div>

        {isUnlocked ? (
          <span className="text-xs text-emerald-500 font-semibold shrink-0">✓ Unlocked</span>
        ) : isScaffold ? (
          <span className="text-xs text-zinc-700 font-mono bg-zinc-800/50 px-1.5 py-0.5 rounded">Future</span>
        ) : (
          <div className="shrink-0 text-right">
            <p className={`text-xs ${isPurchasable && !item.canAfford ? "text-amber-500" : "text-zinc-500"}`}>
              {item.costLabel}
            </p>
            {isPurchasable && (
              <button
                onClick={() => onPurchase(item.id)}
                disabled={!item.canAfford || purchaseLoading === item.id}
                className={`mt-1 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                  !item.canAfford
                    ? "bg-zinc-700/60 text-zinc-500 cursor-not-allowed"
                    : purchaseLoading === item.id
                      ? "bg-indigo-800 text-indigo-300 cursor-wait opacity-75"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white"
                }`}
              >
                {purchaseLoading === item.id ? "Researching…" : "Research →"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ResearchMapPanel({ onClose }: ResearchMapPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [purchaseLoading, setPurchaseLoading] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/game/research/panel");
      const json = await res.json();
      if (json.ok) setData(json.data as PanelData);
      else setFetchError(json.error?.message ?? "Failed to load research data.");
    } catch { setFetchError("Network error."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refetch(); }, [refetch, refreshKey]);

  async function handlePurchase(researchId: string) {
    setPurchaseLoading(researchId);
    setPurchaseError(null);
    try {
      const res = await fetch("/api/game/research/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researchId }),
      });
      const json = await res.json();
      if (!json.ok) setPurchaseError(json.error?.message ?? "Purchase failed.");
      else { setRefreshKey((k) => k + 1); router.refresh(); }
    } catch { setPurchaseError("Network error."); }
    finally { setPurchaseLoading(null); }
  }

  const cat = data?.categories[activeCat] ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      <div className="relative w-full max-w-4xl max-h-[88vh] flex flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-zinc-200">Research Lab</h2>
            {data && (
              <span className="text-xs text-zinc-600">
                Station iron: <span className="font-mono text-zinc-400">{data.stationIron.toLocaleString()}</span>
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Progression summary */}
        {data && (
          <div className="border-b border-zinc-800 px-5 py-3 shrink-0">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2 min-w-[180px]">
                <span className="text-xs text-zinc-600">Upgrade budget:</span>
                <span className="text-xs font-mono text-zinc-300">{data.totalUpgradeCap}</span>
                <span className="text-xs text-zinc-700">/ {data.maxTotalUpgrades}</span>
                <div className="flex-1 min-w-[60px] h-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-600"
                    style={{ width: `${Math.round((data.totalUpgradeCap / data.maxTotalUpgrades) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-zinc-600">Stat caps:</span>
                {STAT_KEYS.map((stat) => (
                  <span key={stat} className="text-xs font-mono bg-zinc-800/60 px-1.5 py-0.5 rounded text-zinc-400">
                    {stat.slice(0, 3).toUpperCase()} {data.statCaps[stat] ?? 2}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Category tabs */}
        {data && (
          <div className="flex gap-1 border-b border-zinc-800 px-4 pt-2 shrink-0 overflow-x-auto">
            {data.categories.map((c, i) => (
              <button
                key={c.id}
                onClick={() => setActiveCat(i)}
                className={`px-3 py-1.5 text-xs rounded-t whitespace-nowrap transition-colors ${
                  i === activeCat ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {c.label}
                <span className="ml-1.5 text-zinc-600">{c.unlockedCount}/{c.totalCount}</span>
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {loading && <p className="text-xs text-zinc-600 text-center py-12">Loading research…</p>}
          {fetchError && <p className="text-xs text-red-400 text-center py-12">{fetchError}</p>}
          {purchaseError && <p className="text-xs text-red-400 mb-2">{purchaseError}</p>}

          {!loading && !fetchError && cat && cat.subGroups.map((sg) => (
            <div key={sg.id}>
              {cat.subGroups.length > 1 && sg.label && (
                <p className="mb-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">{sg.label}</p>
              )}
              {/* Horizontal chain with connector arrows */}
              <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
                {sg.items.map((item, idx) => (
                  <div key={item.id} className="flex items-stretch shrink-0">
                    <ItemCard item={item} onPurchase={handlePurchase} purchaseLoading={purchaseLoading} />
                    {idx < sg.items.length - 1 && (
                      <div className="flex items-center px-1.5 shrink-0 self-center">
                        <span className="text-zinc-700 text-sm select-none">→</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
