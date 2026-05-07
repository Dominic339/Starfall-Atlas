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

// Icons per item category
function CategoryIcon({ category }: { category: string }) {
  if (category === "cosmetic") {
    return (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M8 1.5a.5.5 0 0 1 .5.5v1.586l1.121-1.121a.5.5 0 0 1 .707.707L9.207 4.293 10.793 5.88a.5.5 0 0 1-.707.707L8.5 5.001v1.586l1.121-1.121a.5.5 0 0 1 .707.707L9.207 7.293l1.329 1.329A4.5 4.5 0 0 1 8 13.5a4.5 4.5 0 0 1-2.536-8.207L6.793 4.207l-1.121 1.12a.5.5 0 0 1-.707-.706L6.5 3.5V2a.5.5 0 0 1 .5-.5H8zm0 3.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM7.25 5v3.5l3 1.75-.75 1.25-3.5-2V5h1.25z" />
    </svg>
  );
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
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-amber-600/50 bg-amber-900/20 text-amber-300 hover:bg-amber-800/30 disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-amber-900/30 btn-glow"
      >
        {loading ? (
          <>
            <span className="w-3 h-3 rounded-full border border-amber-600/40 border-t-amber-300 animate-spin" />
            Processing…
          </>
        ) : (
          "Purchase"
        )}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
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

  if (result) return (
    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.25 5.25-4 4.5a.5.5 0 0 1-.75 0l-2-2.25.75-.67 1.625 1.828L10.5 5.58l.75.67z" />
      </svg>
      {result}
    </span>
  );

  return (
    <div>
      <button
        onClick={handleConsume}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-zinc-600/50 bg-zinc-800/30 text-zinc-300 hover:bg-zinc-700/40 disabled:opacity-50 transition-colors"
      >
        {loading ? "Using…" : "Use Item"}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function ItemCard({ item }: { item: ShopItem }) {
  const isCosmetic = item.category === "cosmetic";
  const accentTop  = isCosmetic
    ? "from-violet-600/0 via-violet-500/60 to-violet-600/0"
    : "from-sky-600/0 via-sky-500/60 to-sky-600/0";
  const iconBg     = isCosmetic
    ? "bg-violet-950/60 border-violet-800/40 text-violet-400"
    : "bg-sky-950/60 border-sky-800/40 text-sky-400";
  const badge      = isCosmetic
    ? "bg-violet-900/40 text-violet-400 border-violet-800/40"
    : "bg-sky-900/40 text-sky-400 border-sky-800/40";

  return (
    <div className="relative flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 card-interactive animate-fade-in-up overflow-hidden">
      {/* Top accent line */}
      <div className={`absolute top-0 inset-x-0 h-px bg-gradient-to-r ${accentTop}`} />

      {/* Header: icon + name + price */}
      <div className="flex items-start gap-3.5">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${iconBg}`}>
          <CategoryIcon category={item.category} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-100 leading-snug">{item.name}</p>
            <span className="shrink-0 font-mono text-base font-bold text-amber-400">
              {formatPrice(item.priceCents)}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.description}</p>
        </div>
      </div>

      {/* Footer: badge + buy */}
      <div className="flex items-center justify-between gap-3 pt-1 border-t border-zinc-800/60">
        <span className={`text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded border ${badge}`}>
          {isCosmetic ? "Permanent cosmetic" : "Single-use"}
        </span>
        <BuyButton itemType={item.type} />
      </div>
    </div>
  );
}

function SectionHeading({
  label,
  color,
  count,
}: {
  label: string;
  color: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`h-4 w-0.5 rounded-full ${color}`} />
      <h2 className={`text-[11px] font-bold uppercase tracking-widest ${color === "bg-violet-600" ? "text-violet-400" : color === "bg-sky-600" ? "text-sky-400" : "text-zinc-500"}`}>
        {label}
      </h2>
      {count !== undefined && (
        <span className="text-[10px] text-zinc-700 font-mono">{count} item{count !== 1 ? "s" : ""}</span>
      )}
    </div>
  );
}

export function ShopClient({ catalog, entitlements }: ShopClientProps) {
  const cosmetics = catalog.filter((i) => i.category === "cosmetic");
  const utilities = catalog.filter((i) => i.category === "utility");

  const available = entitlements.filter((e) => !e.consumed);
  const used      = entitlements.filter((e) => e.consumed);

  return (
    <div className="space-y-10">
      {/* ── Cosmetics ──────────────────────────────────────────────────────── */}
      {cosmetics.length > 0 && (
        <section className="space-y-4">
          <SectionHeading label="Cosmetics" color="bg-violet-600" count={cosmetics.length} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 stagger-children">
            {cosmetics.map((item) => (
              <ItemCard key={item.type} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* ── Utility items ─────────────────────────────────────────────────── */}
      {utilities.length > 0 && (
        <section className="space-y-4">
          <SectionHeading label="Mobility & Utility" color="bg-sky-600" count={utilities.length} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 stagger-children">
            {utilities.map((item) => (
              <ItemCard key={item.type} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* ── Your items ────────────────────────────────────────────────────── */}
      {entitlements.length > 0 && (
        <section className="space-y-4">
          <SectionHeading label="Your Items" color="bg-zinc-600" />

          {available.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 font-medium">Ready to use</p>
              <div className="space-y-2 stagger-children">
                {available.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-4 py-3 card-interactive animate-fade-in-up"
                  >
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{e.itemName}</p>
                      <p className="text-xs text-zinc-600 mt-0.5">
                        Purchased {new Date(e.purchasedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ConsumeButton entitlement={e} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {used.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-600 font-medium">Used</p>
              <div className="space-y-2">
                {used.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800/40 bg-zinc-900/20 px-4 py-3 opacity-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-500 line-through">{e.itemName}</p>
                      <p className="text-xs text-zinc-700 mt-0.5">
                        Consumed {new Date(e.purchasedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="text-xs text-zinc-700">Done</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {entitlements.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center border border-dashed border-zinc-800 rounded-xl">
          <svg className="w-7 h-7 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007Z" />
          </svg>
          <p className="text-xs text-zinc-600">No items purchased yet.</p>
        </div>
      )}
    </div>
  );
}
