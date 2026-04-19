"use client";

import { useState } from "react";
import type { ShopItem } from "@/lib/config/shop";
import { formatPrice } from "@/lib/config/shop";
import type { PremiumItemType } from "@/lib/types/enums";

export interface EntitlementEntry {
  id: string;
  itemType: PremiumItemType;
  itemName: string;
  itemConfig: Record<string, unknown>;
  consumed: boolean;
  purchasedAt: string;
}

interface ShopClientProps {
  catalog: ShopItem[];
  entitlements: EntitlementEntry[];
}

function BuyButton({ itemType }: { itemType: PremiumItemType }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleBuy() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/game/shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Purchase failed.");
        return;
      }
      window.location.href = json.data.url;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleBuy}
        disabled={loading}
        className="px-3 py-1.5 text-xs font-semibold rounded border border-amber-600/50 bg-amber-900/20 text-amber-300 hover:bg-amber-800/30 disabled:opacity-50 transition-colors"
      >
        {loading ? "Processing…" : "Purchase"}
      </button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function ConsumeButton({ entitlement }: { entitlement: EntitlementEntry }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function handleConsume() {
    setLoading(true);
    setResult("");
    setError("");
    try {
      const res = await fetch("/api/game/premium/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entitlementId: entitlement.id, params: {} }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Failed to use item.");
        return;
      }
      setResult(json.data.appliedEffect);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  if (result) return <p className="text-xs text-emerald-400">{result}</p>;

  return (
    <div>
      <button
        onClick={handleConsume}
        disabled={loading}
        className="px-3 py-1.5 text-xs font-semibold rounded border border-zinc-600/50 bg-zinc-800/30 text-zinc-300 hover:bg-zinc-700/40 disabled:opacity-50 transition-colors"
      >
        {loading ? "Using…" : "Use Item"}
      </button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function ItemCard({ item }: { item: ShopItem }) {
  return (
    <div className="flex flex-col gap-3 rounded border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-200">{item.name}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{item.description}</p>
        </div>
        <span className="shrink-0 text-sm font-bold text-amber-400">
          {formatPrice(item.priceCents)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded ${
            item.category === "cosmetic"
              ? "bg-violet-900/40 text-violet-400 border border-violet-800/40"
              : "bg-sky-900/40 text-sky-400 border border-sky-800/40"
          }`}
        >
          {item.category === "cosmetic" ? "Cosmetic" : "Single-use"}
        </span>
        <BuyButton itemType={item.type} />
      </div>
    </div>
  );
}

export function ShopClient({ catalog, entitlements }: ShopClientProps) {
  const cosmetics = catalog.filter((i) => i.category === "cosmetic");
  const utilities = catalog.filter((i) => i.category === "utility");

  const available = entitlements.filter((e) => !e.consumed);
  const used = entitlements.filter((e) => e.consumed);

  return (
    <div className="space-y-10">
      {/* ── Cosmetics ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest font-semibold text-violet-400">
          Cosmetics
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cosmetics.map((item) => (
            <ItemCard key={item.type} item={item} />
          ))}
        </div>
      </section>

      {/* ── Utility items ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest font-semibold text-sky-400">
          Mobility &amp; Utility
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {utilities.map((item) => (
            <ItemCard key={item.type} item={item} />
          ))}
        </div>
      </section>

      {/* ── Your items ────────────────────────────────────────────── */}
      {entitlements.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest font-semibold text-zinc-400">
            Your Items
          </h2>

          {available.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">Available</p>
              {available.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-4 rounded border border-zinc-800 bg-zinc-900/40 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{e.itemName}</p>
                    <p className="text-xs text-zinc-600">
                      Purchased {new Date(e.purchasedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <ConsumeButton entitlement={e} />
                </div>
              ))}
            </div>
          )}

          {used.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">Used</p>
              {used.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-4 rounded border border-zinc-800/50 bg-zinc-900/20 px-4 py-3 opacity-50"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-400 line-through">{e.itemName}</p>
                    <p className="text-xs text-zinc-600">
                      Used {new Date(e.purchasedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-600">Consumed</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
