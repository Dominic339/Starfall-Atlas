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
  const [tab, setTab] = useState<"buy" | "sell" | "auctions">("buy");

  // Auction state (lazy loaded when tab first opened)
  interface AuctionItem {
    id: string; itemType: string; itemLabel: string;
    minBid: number; currentHighBid: number;
    isOwnAuction: boolean; isHighBidder: boolean;
    sellerHandle: string; timeLeft: string; endsAt: string;
  }
  interface EligibleItem { id: string; type: "colony" | "stewardship"; label: string; }
  interface AuctionData { auctions: AuctionItem[]; eligibleItems: EligibleItem[]; playerCredits: number; }
  const [auctionData, setAuctionData] = useState<AuctionData | null>(null);
  const [auctionLoading, setAuctionLoading] = useState(false);
  const [auctionLoaded, setAuctionLoaded] = useState(false);
  const [bidAmounts, setBidAmounts] = useState<Record<string, string>>({});
  const [bidLoading, setBidLoading] = useState<string | null>(null);
  const [bidMsg, setBidMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [createItemId, setCreateItemId] = useState("");
  const [createItemType, setCreateItemType] = useState<"colony" | "stewardship">("colony");
  const [createMinBid, setCreateMinBid] = useState(0);
  const [createDuration, setCreateDuration] = useState(24);
  const [createLoading, setCreateLoading] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null);
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

  // Lazy-load auction data the first time the auctions tab is opened
  useEffect(() => {
    if (tab !== "auctions" || auctionLoaded) return;
    setAuctionLoading(true);
    fetch("/api/game/auction/panel")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setAuctionData(json.data as AuctionData); })
      .catch(() => {})
      .finally(() => { setAuctionLoading(false); setAuctionLoaded(true); });
  }, [tab, auctionLoaded]);

  async function handleBid(auctionId: string) {
    const amt = parseInt(bidAmounts[auctionId] ?? "0", 10);
    if (!amt) return;
    setBidLoading(auctionId); setBidMsg(null);
    try {
      const res = await fetch("/api/game/auction/bid", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId, amount: amt }),
      });
      const json = await res.json();
      if (json.ok) {
        setBidMsg({ id: auctionId, ok: true, text: "Bid placed!" });
        setAuctionLoaded(false); // trigger reload
      } else {
        setBidMsg({ id: auctionId, ok: false, text: json.error?.message ?? "Bid failed." });
      }
    } catch { setBidMsg({ id: auctionId, ok: false, text: "Network error." }); }
    finally { setBidLoading(null); }
  }

  async function handleCreateAuction() {
    if (!createItemId) return;
    setCreateLoading(true); setCreateMsg(null);
    try {
      const res = await fetch("/api/game/auction/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType: createItemType, itemId: createItemId, minBid: createMinBid, durationHours: createDuration }),
      });
      const json = await res.json();
      if (json.ok) {
        setCreateMsg({ ok: true, text: "Auction created!" });
        setAuctionLoaded(false);
      } else {
        setCreateMsg({ ok: false, text: json.error?.message ?? "Failed." });
      }
    } catch { setCreateMsg({ ok: false, text: "Network error." }); }
    finally { setCreateLoading(false); }
  }

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
          <button onClick={() => setTab("buy")} className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${tab === "buy" ? "bg-zinc-800 text-zinc-200 border-b-2 border-amber-600" : "text-zinc-600 hover:text-zinc-400"}`}>
            Browse{data ? ` (${otherListings.length})` : ""}
          </button>
          <button onClick={() => setTab("sell")} className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${tab === "sell" ? "bg-zinc-800 text-zinc-200 border-b-2 border-amber-600" : "text-zinc-600 hover:text-zinc-400"}`}>
            Sell{data && myListings.length > 0 ? ` · ${myListings.length}` : ""}
          </button>
          <button onClick={() => setTab("auctions")} className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${tab === "auctions" ? "bg-zinc-800 text-zinc-200 border-b-2 border-amber-600" : "text-zinc-600 hover:text-zinc-400"}`}>
            Auctions{auctionData ? ` (${auctionData.auctions.length})` : ""}
          </button>
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

          {/* ── Auctions tab ──────────────────────────────────────────────── */}
          {tab === "auctions" && (
            <div className="space-y-4">
              {auctionLoading && <p className="text-xs text-zinc-600 text-center py-8 animate-pulse">Loading auctions…</p>}

              {auctionLoaded && auctionData && (
                <>
                  {/* Active auctions */}
                  {auctionData.auctions.length === 0 ? (
                    <p className="text-sm text-zinc-600 text-center py-6">No active auctions.</p>
                  ) : (
                    <div className="space-y-2">
                      {auctionData.auctions.map((a) => {
                        const minNext = Math.max(a.minBid, a.currentHighBid + 1);
                        const msg = bidMsg?.id === a.id ? bidMsg : null;
                        return (
                          <div key={a.id} className={`rounded-xl border px-4 py-3 space-y-2 ${
                            a.isOwnAuction ? "border-amber-900/40 bg-amber-950/10" :
                            a.isHighBidder ? "border-emerald-900/40 bg-emerald-950/10" :
                            "border-zinc-800 bg-zinc-900/40"
                          }`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-zinc-200 truncate">{a.itemLabel}</p>
                                <p className="text-[10px] text-zinc-600 mt-0.5">
                                  Seller: <span className="text-zinc-400">{a.sellerHandle}</span>
                                  <span className="mx-1.5 text-zinc-700">·</span>
                                  <span className={a.isHighBidder ? "text-emerald-400" : "text-zinc-500"}>
                                    {a.isHighBidder ? "You're winning" : `High bid: ${a.currentHighBid.toLocaleString()} ¢`}
                                  </span>
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="font-mono text-sm font-bold text-amber-400">{a.currentHighBid.toLocaleString()}<span className="text-amber-700 text-[10px]"> ¢</span></p>
                                <p className="text-[10px] text-zinc-600">{a.timeLeft} left</p>
                              </div>
                            </div>
                            {!a.isOwnAuction && (
                              <div className="flex items-center gap-2">
                                <input
                                  type="number" min={minNext}
                                  value={bidAmounts[a.id] ?? minNext}
                                  onChange={(e) => setBidAmounts((p) => ({ ...p, [a.id]: e.target.value }))}
                                  className="w-28 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500 text-center"
                                />
                                <span className="text-[10px] text-zinc-600">¢ min</span>
                                <button
                                  onClick={() => handleBid(a.id)}
                                  disabled={bidLoading === a.id}
                                  className="rounded-lg px-3 py-1 text-xs font-bold border border-amber-800/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40 disabled:opacity-50 transition-colors"
                                >
                                  {bidLoading === a.id ? "…" : "Bid"}
                                </button>
                                {msg && <span className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>}
                              </div>
                            )}
                            {a.isOwnAuction && <p className="text-[10px] text-amber-600/80">Your auction</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Create auction */}
                  {auctionData.eligibleItems.length > 0 && (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Create Auction</p>
                      <select
                        value={createItemId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setCreateItemId(id);
                          const item = auctionData.eligibleItems.find((i) => i.id === id);
                          if (item) setCreateItemType(item.type);
                        }}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                      >
                        <option value="">Select item…</option>
                        {auctionData.eligibleItems.map((i) => (
                          <option key={i.id} value={i.id}>{i.label}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="text-[10px] text-zinc-600 block mb-1">Min bid (¢)</label>
                          <input type="number" min={0} value={createMinBid} onChange={(e) => setCreateMinBid(parseInt(e.target.value) || 0)}
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500" />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-zinc-600 block mb-1">Duration (hrs)</label>
                          <input type="number" min={1} max={168} value={createDuration} onChange={(e) => setCreateDuration(parseInt(e.target.value) || 24)}
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500" />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={handleCreateAuction} disabled={createLoading || !createItemId}
                          className="rounded-lg px-4 py-1.5 text-xs font-bold border border-amber-800/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40 disabled:opacity-50 transition-colors">
                          {createLoading ? "Creating…" : "List Auction"}
                        </button>
                        {createMsg && <span className={`text-xs ${createMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{createMsg.text}</span>}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
