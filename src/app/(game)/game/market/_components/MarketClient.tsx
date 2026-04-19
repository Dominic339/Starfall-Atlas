"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketListing {
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

export interface StationInventoryEntry {
  resourceType: string;
  quantity: number;
}

interface MarketClientProps {
  listings: MarketListing[];
  myInventory: StationInventoryEntry[];
  playerCredits: number;
  playerId: string;
  listingFeePercent: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOURCE_LABELS: Record<string, string> = {
  iron:             "Iron",
  carbon:           "Carbon",
  silica:           "Silica",
  water:            "Water",
  biomass:          "Biomass",
  sulfur:           "Sulfur",
  rare_crystal:     "Rare Crystal",
  food:             "Food",
  steel:            "Steel",
  glass:            "Glass",
  exotic_matter:    "Exotic Matter",
  crystalline_core: "Crystalline Core",
  void_dust:        "Void Dust",
  ice:              "Ice",
  fuel_cells:       "Fuel Cells",
  polymers:         "Polymers",
};

function resourceLabel(rt: string): string {
  return RESOURCE_LABELS[rt] ?? rt.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatExpiry(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

// ---------------------------------------------------------------------------
// Buy button
// ---------------------------------------------------------------------------

function BuyButton({ listing, playerCredits }: { listing: MarketListing; playerCredits: number }) {
  const [qty, setQty] = useState(listing.quantity - listing.quantityFilled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();
  const remaining = listing.quantity - listing.quantityFilled;
  const total = qty * listing.pricePerUnit;
  const canAfford = playerCredits >= total;

  if (done) return <span className="text-xs text-emerald-400">Purchased!</span>;

  async function handleBuy() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/market/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: listing.id, quantity: qty }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Purchase failed.");
      } else {
        setDone(true);
        router.refresh();
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={1}
        max={remaining}
        value={qty}
        onChange={(e) => setQty(Math.max(1, Math.min(remaining, Number(e.target.value) || 1)))}
        className="w-14 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-center text-xs text-zinc-200 focus:border-indigo-600 focus:outline-none"
      />
      <button
        onClick={handleBuy}
        disabled={loading || !canAfford}
        title={!canAfford ? `Need ${total} ¢` : `Buy ${qty} for ${total} ¢`}
        className="rounded border border-indigo-700/60 bg-indigo-950/40 px-2.5 py-1 text-xs text-indigo-300 hover:bg-indigo-900/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {loading ? "…" : `Buy (${total.toLocaleString()} ¢)`}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cancel button
// ---------------------------------------------------------------------------

function CancelButton({ listingId }: { listingId: string }) {
  const [state, setState] = useState<"idle" | "confirm" | "loading">("idle");
  const [done, setDone] = useState(false);
  const router = useRouter();

  if (done) return <span className="text-xs text-zinc-600">Cancelled</span>;

  if (state === "confirm") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-zinc-500">Cancel listing?</span>
        <button
          onClick={async () => {
            setState("loading");
            try {
              const res = await fetch("/api/game/market/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ listingId }),
              });
              const json = await res.json();
              if (json.ok) { setDone(true); router.refresh(); }
              else setState("idle");
            } catch { setState("idle"); }
          }}
          className="text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          Confirm
        </button>
        <button onClick={() => setState("idle")} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
          Keep
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setState("confirm")}
      disabled={state === "loading"}
      className="rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-600 hover:border-red-900/60 hover:text-red-500 transition-colors"
    >
      Cancel
    </button>
  );
}

// ---------------------------------------------------------------------------
// Create listing form
// ---------------------------------------------------------------------------

function CreateListingForm({
  inventory,
  listingFeePercent,
}: {
  inventory: StationInventoryEntry[];
  listingFeePercent: number;
}) {
  const [resourceType, setResourceType] = useState(inventory[0]?.resourceType ?? "iron");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const available = inventory.find((i) => i.resourceType === resourceType)?.quantity ?? 0;
  const fee = Math.floor(qty * price * (listingFeePercent / 100));
  const totalRevenue = qty * price - fee;

  if (success) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-emerald-400">Listing created!</span>
        <button
          onClick={() => { setSuccess(false); setQty(1); }}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Create another
        </button>
      </div>
    );
  }

  async function handleList() {
    if (qty > available) {
      setError(`Only ${available} ${resourceLabel(resourceType)} available.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/market/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType, quantity: qty, pricePerUnit: price }),
      });
      const json = await res.json();
      if (json.ok) {
        setSuccess(true);
        router.refresh();
      } else {
        setError(json.error?.message ?? "Failed to create listing.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {/* Resource selector */}
        <div>
          <label className="mb-1 block text-xs text-zinc-600">Resource</label>
          <select
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-600 focus:outline-none"
          >
            {inventory.map((i) => (
              <option key={i.resourceType} value={i.resourceType}>
                {resourceLabel(i.resourceType)} ({i.quantity.toLocaleString()})
              </option>
            ))}
          </select>
        </div>

        {/* Quantity */}
        <div>
          <label className="mb-1 block text-xs text-zinc-600">Quantity</label>
          <input
            type="number"
            min={1}
            max={available}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(available, Number(e.target.value) || 1)))}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-600 focus:outline-none"
          />
          <p className="mt-0.5 text-xs text-zinc-700">of {available.toLocaleString()}</p>
        </div>

        {/* Price per unit */}
        <div>
          <label className="mb-1 block text-xs text-zinc-600">Price / unit (¢)</label>
          <input
            type="number"
            min={1}
            value={price}
            onChange={(e) => setPrice(Math.max(1, Number(e.target.value) || 1))}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Fee preview */}
      <div className="flex items-center justify-between rounded border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-xs">
        <span className="text-zinc-600">
          Listing fee ({listingFeePercent}%): <span className="text-zinc-400">{fee.toLocaleString()} ¢</span>
        </span>
        <span className="text-zinc-500">
          You receive: <span className="text-emerald-400">{totalRevenue.toLocaleString()} ¢</span>{" "}
          <span className="text-zinc-700">(when sold)</span>
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleList}
          disabled={loading || available === 0}
          className="rounded border border-amber-800/60 bg-amber-950/40 px-4 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {loading ? "Listing…" : "Create Listing"}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MarketClient({
  listings,
  myInventory,
  playerCredits,
  playerId,
  listingFeePercent,
}: MarketClientProps) {
  const [resourceFilter, setResourceFilter] = useState<string>("all");
  const myListings = listings.filter((l) => l.sellerId === playerId);
  const otherListings = listings.filter((l) => l.sellerId !== playerId);

  const allResourceTypes = [...new Set(listings.map((l) => l.resourceType))].sort();
  const filtered = resourceFilter === "all"
    ? otherListings
    : otherListings.filter((l) => l.resourceType === resourceFilter);

  // Sort: cheapest price first within each resource
  const sorted = [...filtered].sort((a, b) => a.pricePerUnit - b.pricePerUnit);

  // Group by resource type for display
  const grouped = new Map<string, MarketListing[]>();
  for (const l of sorted) {
    if (!grouped.has(l.resourceType)) grouped.set(l.resourceType, []);
    grouped.get(l.resourceType)!.push(l);
  }

  return (
    <div className="space-y-8">
      {/* ── Create listing ───────────────────────────────────────────────── */}
      {myInventory.length > 0 && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-block h-3.5 w-0.5 rounded-full bg-amber-700" />
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
              Create Listing
            </h2>
          </div>
          <div className="rounded border border-zinc-800/60 bg-zinc-900/30 p-4">
            <CreateListingForm inventory={myInventory} listingFeePercent={listingFeePercent} />
          </div>
        </section>
      )}
      {myInventory.length === 0 && (
        <section>
          <p className="text-xs text-zinc-600">
            No resources at your station to list. Extract from colonies or unload ship cargo first.
          </p>
        </section>
      )}

      {/* ── Your active listings ─────────────────────────────────────────── */}
      {myListings.length > 0 && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-block h-3.5 w-0.5 rounded-full bg-zinc-600" />
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
              Your Listings
            </h2>
          </div>
          <div className="overflow-hidden rounded border border-zinc-800/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800/60 bg-zinc-900/50">
                  <th className="px-3 py-2 text-left font-medium text-zinc-600">Resource</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600">Remaining</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600">Price/unit</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600">Value</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600">Expires</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {myListings.map((l) => {
                  const remaining = l.quantity - l.quantityFilled;
                  const value = remaining * l.pricePerUnit;
                  return (
                    <tr key={l.id} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="px-3 py-2 text-zinc-300">{resourceLabel(l.resourceType)}</td>
                      <td className="px-3 py-2 text-right text-zinc-400">
                        {remaining.toLocaleString()}
                        {l.quantityFilled > 0 && (
                          <span className="ml-1 text-zinc-600">({l.quantityFilled} sold)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-400">{l.pricePerUnit.toLocaleString()} ¢</td>
                      <td className="px-3 py-2 text-right text-emerald-500/80">{value.toLocaleString()} ¢</td>
                      <td className="px-3 py-2 text-right text-zinc-600">{formatExpiry(l.expiresAt)}</td>
                      <td className="px-3 py-2 text-right">
                        <CancelButton listingId={l.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Market listings ──────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-0.5 rounded-full bg-indigo-700" />
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
              Available Listings
            </h2>
            {otherListings.length > 0 && (
              <span className="text-xs text-zinc-700">{otherListings.length} total</span>
            )}
          </div>
          {allResourceTypes.length > 0 && (
            <select
              value={resourceFilter}
              onChange={(e) => setResourceFilter(e.target.value)}
              className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 focus:outline-none"
            >
              <option value="all">All resources</option>
              {allResourceTypes.map((rt) => (
                <option key={rt} value={rt}>{resourceLabel(rt)}</option>
              ))}
            </select>
          )}
        </div>

        {sorted.length === 0 && (
          <p className="text-xs text-zinc-700">
            {otherListings.length === 0 ? "No listings on the market." : "No listings match the filter."}
          </p>
        )}

        {grouped.size > 0 && (
          <div className="space-y-4">
            {[...grouped.entries()].map(([rt, group]) => (
              <div key={rt}>
                <p className="mb-1.5 text-xs font-medium text-zinc-500">{resourceLabel(rt)}</p>
                <div className="overflow-hidden rounded border border-zinc-800/60">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800/60 bg-zinc-900/50">
                        <th className="px-3 py-2 text-left font-medium text-zinc-600">Seller</th>
                        <th className="px-3 py-2 text-right font-medium text-zinc-600">Qty</th>
                        <th className="px-3 py-2 text-right font-medium text-zinc-600">Price/unit</th>
                        <th className="px-3 py-2 text-right font-medium text-zinc-600">System</th>
                        <th className="px-3 py-2 text-right font-medium text-zinc-600">Expires</th>
                        <th className="px-3 py-2 text-right font-medium text-zinc-600">Buy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/40">
                      {group.map((l) => {
                        const remaining = l.quantity - l.quantityFilled;
                        return (
                          <tr key={l.id} className="hover:bg-zinc-900/40 transition-colors">
                            <td className="px-3 py-2 text-zinc-400">@{l.sellerHandle}</td>
                            <td className="px-3 py-2 text-right text-zinc-300">{remaining.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono text-amber-400/90">{l.pricePerUnit.toLocaleString()} ¢</td>
                            <td className="px-3 py-2 text-right text-zinc-600">{l.systemId}</td>
                            <td className="px-3 py-2 text-right text-zinc-600">{formatExpiry(l.expiresAt)}</td>
                            <td className="px-3 py-2 text-right">
                              <BuyButton listing={l} playerCredits={playerCredits} />
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
      </section>
    </div>
  );
}
