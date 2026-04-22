"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Listing {
  id: string;
  resourceType: string;
  quantity: number;
  quantityFilled: number;
  pricePerUnit: number;
  sellerHandle: string;
  sellerId: string;
  systemId: string;
  expiresAt: string;
  status: "open" | "partially_filled";
}

interface InventoryEntry { resourceType: string; quantity: number; }

interface PanelData {
  listings: Listing[];
  inventory: InventoryEntry[];
  playerCredits: number;
  playerId: string;
  listingFeePercent: number;
}

interface MarketMapPanelProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RES_LABELS: Record<string, string> = {
  iron: "Iron", carbon: "Carbon", silica: "Silica", water: "Water",
  biomass: "Biomass", sulfur: "Sulfur", rare_crystal: "Rare Crystal",
  food: "Food", steel: "Steel", glass: "Glass",
  exotic_matter: "Exotic Matter", crystalline_core: "Crystalline Core",
  void_dust: "Void Dust", ice: "Ice", fuel_cells: "Fuel Cells", polymers: "Polymers",
};

function resLabel(rt: string) {
  return RES_LABELS[rt] ?? rt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtExpiry(at: string) {
  const ms = new Date(at).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MarketMapPanel({ onClose }: MarketMapPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [refreshKey, setRefreshKey] = useState(0);

  // Create listing form state
  const [listRes, setListRes] = useState("");
  const [listQty, setListQty] = useState(1);
  const [listPrice, setListPrice] = useState(10);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Buy/cancel per-listing state
  const [buyQty, setBuyQty] = useState<Record<string, number>>({});
  const [buyLoading, setBuyLoading] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<Record<string, string>>({});
  const [cancelLoading, setCancelLoading] = useState<string | null>(null);

  // Filter for browse tab
  const [resFilter, setResFilter] = useState("all");

  const refetch = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/game/market/panel");
      const json = await res.json();
      if (json.ok) {
        setData(json.data as PanelData);
        // initialise buy qty for any new listings
        setBuyQty((prev) => {
          const next = { ...prev };
          for (const l of json.data.listings as Listing[]) {
            if (!(l.id in next)) next[l.id] = l.quantity - l.quantityFilled;
          }
          return next;
        });
        if (!listRes && json.data.inventory.length > 0) {
          setListRes((json.data.inventory as InventoryEntry[])[0].resourceType);
        }
      } else {
        setFetchError(json.error?.message ?? "Failed to load market data.");
      }
    } catch {
      setFetchError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [listRes]);

  useEffect(() => { void refetch(); }, [refetch, refreshKey]);

  const afterAction = () => {
    setRefreshKey((k) => k + 1);
    router.refresh();
  };

  async function handleBuy(listingId: string) {
    const qty = buyQty[listingId] ?? 1;
    setBuyLoading(listingId);
    setBuyError((p) => ({ ...p, [listingId]: "" }));
    try {
      const res = await fetch("/api/game/market/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, quantity: qty }),
      });
      const json = await res.json();
      if (!json.ok) setBuyError((p) => ({ ...p, [listingId]: json.error?.message ?? "Purchase failed." }));
      else afterAction();
    } catch { setBuyError((p) => ({ ...p, [listingId]: "Network error." })); }
    finally { setBuyLoading(null); }
  }

  async function handleCancel(listingId: string) {
    setCancelLoading(listingId);
    try {
      const res = await fetch("/api/game/market/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      const json = await res.json();
      if (json.ok) afterAction();
    } catch {}
    finally { setCancelLoading(null); }
  }

  async function handleList() {
    if (!data) return;
    const available = data.inventory.find((i) => i.resourceType === listRes)?.quantity ?? 0;
    if (listQty > available) { setListError(`Only ${available} available.`); return; }
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/game/market/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType: listRes, quantity: listQty, pricePerUnit: listPrice }),
      });
      const json = await res.json();
      if (!json.ok) setListError(json.error?.message ?? "Failed to create listing.");
      else { setListQty(1); afterAction(); setTab("buy"); }
    } catch { setListError("Network error."); }
    finally { setListLoading(false); }
  }

  // Derived display data
  const myListings = data?.listings.filter((l) => l.sellerId === data.playerId) ?? [];
  const otherListings = data?.listings.filter((l) => l.sellerId !== data?.playerId) ?? [];
  const allTypes = [...new Set(otherListings.map((l) => l.resourceType))].sort();
  const filtered = resFilter === "all" ? otherListings : otherListings.filter((l) => l.resourceType === resFilter);
  const grouped = new Map<string, Listing[]>();
  for (const l of filtered) {
    const g = grouped.get(l.resourceType) ?? [];
    g.push(l);
    grouped.set(l.resourceType, g);
  }

  const listAvailable = listRes ? (data?.inventory.find((i) => i.resourceType === listRes)?.quantity ?? 0) : 0;
  const listFee = Math.floor(listQty * listPrice * ((data?.listingFeePercent ?? 0) / 100));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      <div className="relative w-full max-w-3xl max-h-[88vh] flex flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-zinc-200">Resource Market</h2>
            {data && (
              <span className="text-xs text-zinc-600">
                Balance: <span className="font-mono text-amber-400">{data.playerCredits.toLocaleString()} ¢</span>
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-zinc-800 px-4 pt-2 shrink-0">
          {(["buy", "sell"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-xs rounded-t transition-colors capitalize ${
                tab === t ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {t === "buy" ? `Browse (${otherListings.length})` : `Sell${myListings.length > 0 ? ` · ${myListings.length} active` : ""}`}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">

          {loading && <p className="text-xs text-zinc-600 text-center py-12">Loading market…</p>}
          {fetchError && <p className="text-xs text-red-400 text-center py-12">{fetchError}</p>}

          {/* ── Buy tab ─────────────────────────────────────────────────── */}
          {!loading && !fetchError && tab === "buy" && (
            <div className="space-y-4">
              {/* Filter */}
              {allTypes.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-600">Filter:</span>
                  <select
                    value={resFilter}
                    onChange={(e) => setResFilter(e.target.value)}
                    className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 focus:outline-none"
                  >
                    <option value="all">All</option>
                    {allTypes.map((rt) => <option key={rt} value={rt}>{resLabel(rt)}</option>)}
                  </select>
                  <span className="text-xs text-zinc-700">{filtered.length} listings</span>
                </div>
              )}

              {grouped.size === 0 && (
                <p className="text-xs text-zinc-700 text-center py-8">
                  {otherListings.length === 0 ? "No listings on the market." : "No listings match the filter."}
                </p>
              )}

              {[...grouped.entries()].map(([rt, group]) => (
                <div key={rt}>
                  <p className="mb-1.5 text-xs font-medium text-zinc-500">{resLabel(rt)}</p>
                  <div className="overflow-hidden rounded border border-zinc-800/60">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800/60 bg-zinc-900/50 text-zinc-600">
                          <th className="px-3 py-2 text-left font-medium">Seller</th>
                          <th className="px-3 py-2 text-right font-medium">Qty</th>
                          <th className="px-3 py-2 text-right font-medium">¢/unit</th>
                          <th className="px-3 py-2 text-right font-medium">Expires</th>
                          <th className="px-3 py-2 text-right font-medium">Buy</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/40">
                        {group.map((l) => {
                          const remaining = l.quantity - l.quantityFilled;
                          const qty = buyQty[l.id] ?? remaining;
                          const total = qty * l.pricePerUnit;
                          const canAfford = (data?.playerCredits ?? 0) >= total;
                          return (
                            <tr key={l.id} className="hover:bg-zinc-900/30">
                              <td className="px-3 py-2 text-zinc-400">@{l.sellerHandle}</td>
                              <td className="px-3 py-2 text-right text-zinc-300">{remaining.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right font-mono text-amber-400/90">{l.pricePerUnit.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-zinc-600">{fmtExpiry(l.expiresAt)}</td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <input
                                    type="number" min={1} max={remaining}
                                    value={qty}
                                    onChange={(e) => setBuyQty((p) => ({ ...p, [l.id]: Math.max(1, Math.min(remaining, Number(e.target.value) || 1)) }))}
                                    className="w-14 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-center text-xs text-zinc-200 focus:outline-none"
                                  />
                                  <button
                                    onClick={() => handleBuy(l.id)}
                                    disabled={buyLoading === l.id || !canAfford}
                                    title={!canAfford ? `Need ${total} ¢` : undefined}
                                    className="rounded border border-indigo-700/60 bg-indigo-950/40 px-2.5 py-1 text-xs text-indigo-300 hover:bg-indigo-900/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                                  >
                                    {buyLoading === l.id ? "…" : `${total.toLocaleString()} ¢`}
                                  </button>
                                </div>
                                {buyError[l.id] && <p className="text-xs text-red-400 mt-0.5">{buyError[l.id]}</p>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Sell tab ─────────────────────────────────────────────────── */}
          {!loading && !fetchError && tab === "sell" && (
            <div className="space-y-6">

              {/* Create listing form */}
              {data && data.inventory.length > 0 ? (
                <div className="rounded border border-zinc-800/60 bg-zinc-900/30 p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Create Listing</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-zinc-600">Resource</label>
                      <select
                        value={listRes}
                        onChange={(e) => setListRes(e.target.value)}
                        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-600 focus:outline-none"
                      >
                        {data.inventory.map((i) => (
                          <option key={i.resourceType} value={i.resourceType}>
                            {resLabel(i.resourceType)} ({i.quantity.toLocaleString()})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-zinc-600">Quantity</label>
                      <input
                        type="number" min={1} max={listAvailable} value={listQty}
                        onChange={(e) => setListQty(Math.max(1, Math.min(listAvailable, Number(e.target.value) || 1)))}
                        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-600 focus:outline-none"
                      />
                      <p className="mt-0.5 text-xs text-zinc-700">of {listAvailable.toLocaleString()}</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-zinc-600">Price / unit (¢)</label>
                      <input
                        type="number" min={1} value={listPrice}
                        onChange={(e) => setListPrice(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-600 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-xs">
                    <span className="text-zinc-600">
                      Fee ({data.listingFeePercent}%): <span className="text-zinc-400">{listFee.toLocaleString()} ¢</span>
                    </span>
                    <span className="text-zinc-500">
                      You receive: <span className="text-emerald-400">{(listQty * listPrice - listFee).toLocaleString()} ¢</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleList}
                      disabled={listLoading || listAvailable === 0}
                      className="rounded border border-amber-800/60 bg-amber-950/40 px-4 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-900/50 disabled:opacity-50 transition-colors"
                    >
                      {listLoading ? "Listing…" : "Create Listing"}
                    </button>
                    {listError && <span className="text-xs text-red-400">{listError}</span>}
                  </div>
                </div>
              ) : (
                !loading && <p className="text-xs text-zinc-600">No resources at station to list.</p>
              )}

              {/* My active listings */}
              {myListings.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Your Active Listings</p>
                  <div className="overflow-hidden rounded border border-zinc-800/60">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800/60 bg-zinc-900/50 text-zinc-600">
                          <th className="px-3 py-2 text-left font-medium">Resource</th>
                          <th className="px-3 py-2 text-right font-medium">Remaining</th>
                          <th className="px-3 py-2 text-right font-medium">¢/unit</th>
                          <th className="px-3 py-2 text-right font-medium">Expires</th>
                          <th className="px-3 py-2 text-right font-medium"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/40">
                        {myListings.map((l) => {
                          const remaining = l.quantity - l.quantityFilled;
                          return (
                            <tr key={l.id} className="hover:bg-zinc-900/30">
                              <td className="px-3 py-2 text-zinc-300">{resLabel(l.resourceType)}</td>
                              <td className="px-3 py-2 text-right text-zinc-400">
                                {remaining.toLocaleString()}
                                {l.quantityFilled > 0 && <span className="ml-1 text-zinc-600">({l.quantityFilled} sold)</span>}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-amber-400/80">{l.pricePerUnit.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-zinc-600">{fmtExpiry(l.expiresAt)}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  onClick={() => handleCancel(l.id)}
                                  disabled={cancelLoading === l.id}
                                  className="rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-600 hover:border-red-900/60 hover:text-red-500 transition-colors disabled:opacity-50"
                                >
                                  {cancelLoading === l.id ? "…" : "Cancel"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
