"use client";

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ItemCategory = "cosmetic" | "utility";

interface ShopItem {
  type: string;
  name: string;
  description: string;
  priceCents: number;
  category: ItemCategory;
  stackable: boolean;
}

interface Entitlement {
  id: string;
  itemType: string;
  itemName: string;
  consumed: boolean;
  purchasedAt: string;
}

interface PanelData {
  catalog: ShopItem[];
  entitlements: Entitlement[];
}

interface ShopMapPanelProps { onClose: () => void; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// ItemCard
// ---------------------------------------------------------------------------

function ItemCard({ item }: { item: ShopItem }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCosmetic = item.category === "cosmetic";

  async function handleBuy() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType: item.type }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error?.message ?? "Purchase failed."); return; }
      window.location.href = json.data.url;
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`relative flex flex-col gap-3 rounded-xl border p-4 overflow-hidden transition-all ${
      isCosmetic
        ? "border-violet-900/50 bg-gradient-to-br from-violet-950/20 via-zinc-900/60 to-zinc-950 hover:border-violet-800/60"
        : "border-sky-900/50 bg-gradient-to-br from-sky-950/20 via-zinc-900/60 to-zinc-950 hover:border-sky-800/60"
    }`}>

      {/* Category glow accent */}
      <div className={`absolute top-0 left-0 right-0 h-px ${isCosmetic ? "bg-violet-700/30" : "bg-sky-700/30"}`} />

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-zinc-100 leading-snug">{item.name}</p>
        <span className="shrink-0 font-mono text-base font-bold text-amber-400 tabular-nums">
          {fmt(item.priceCents)}
        </span>
      </div>

      {/* Description */}
      <p className="text-xs text-zinc-500 leading-relaxed flex-1">{item.description}</p>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${
          isCosmetic
            ? "border-violet-800/50 bg-violet-950/40 text-violet-400"
            : "border-sky-800/50 bg-sky-950/40 text-sky-400"
        }`}>
          {isCosmetic ? "Cosmetic" : "Single-use"}
        </span>

        <div className="flex flex-col items-end gap-1">
          <button
            onClick={handleBuy}
            disabled={loading}
            className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-50 border border-amber-700/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40 hover:border-amber-600/60"
          >
            {loading ? "Redirecting…" : "Purchase →"}
          </button>
          {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ShopMapPanel({ onClose }: ShopMapPanelProps) {
  const [tab, setTab] = useState<"catalog" | "owned">("catalog");
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/game/shop/panel")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setData(json.data as PanelData); else setError("Failed to load."); })
      .catch(() => setError("Network error."))
      .finally(() => setLoading(false));
  }, []);

  const cosmetics  = data?.catalog.filter((i) => i.category === "cosmetic") ?? [];
  const utilities  = data?.catalog.filter((i) => i.category === "utility") ?? [];
  const owned      = data?.entitlements.filter((e) => !e.consumed) ?? [];
  const consumed   = data?.entitlements.filter((e) => e.consumed) ?? [];
  const ownedCount = data?.entitlements.length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-zinc-700/80 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden">

        {/* Header */}
        <div className="shrink-0 border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-950 px-5 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Premium Shop</h2>
              <p className="mt-0.5 text-[10px] text-zinc-600">
                Cosmetics and utilities — no gameplay advantages sold.
              </p>
            </div>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none mt-0.5">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex border-b border-zinc-800 px-4 pt-2 gap-1">
          {([
            { id: "catalog", label: "Catalog" },
            { id: "owned",   label: `Your Items${ownedCount > 0 ? ` (${ownedCount})` : ""}` },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                tab === t.id
                  ? "bg-zinc-800 text-zinc-200 border-b-2 border-amber-600"
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
              <p className="text-xs text-zinc-600 uppercase tracking-widest animate-pulse">Loading…</p>
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-400 text-center">{error}</div>
          )}

          {/* Catalog tab */}
          {!loading && !error && tab === "catalog" && data && (
            <div className="space-y-6">
              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-500">Cosmetics</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {cosmetics.map((item) => <ItemCard key={item.type} item={item} />)}
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-sky-500">Utility</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {utilities.map((item) => <ItemCard key={item.type} item={item} />)}
                </div>
              </div>
            </div>
          )}

          {/* Owned tab */}
          {!loading && !error && tab === "owned" && (
            <div className="space-y-4">
              {ownedCount === 0 && (
                <div className="py-12 text-center">
                  <p className="text-sm text-zinc-600">No purchases yet.</p>
                </div>
              )}
              {owned.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Available</p>
                  {owned.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-4 rounded-lg border border-emerald-900/40 bg-emerald-950/10 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-200">{e.itemName}</p>
                        <p className="text-[10px] text-zinc-600 mt-0.5">
                          Purchased {new Date(e.purchasedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-emerald-800/50 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        Owned
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {consumed.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-700">Used</p>
                  {consumed.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-4 rounded-lg border border-zinc-800/40 bg-zinc-900/20 px-4 py-3 opacity-40">
                      <p className="text-sm text-zinc-500 line-through">{e.itemName}</p>
                      <span className="text-[10px] text-zinc-700">Consumed</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
