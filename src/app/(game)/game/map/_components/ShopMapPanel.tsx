"use client";

import { useState, useEffect, useCallback } from "react";
import type { SkinDefinition, SkinRarity } from "@/skins";
import { RARITY_COLOR, RARITY_LABEL } from "@/skins";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShopSkin {
  id: string; name: string; description: string;
  type: string; rarity: string;
  visual: { color?: string; accentColor?: string; shape?: string };
  priceCredits: number; effectivePrice: number;
  premiumCents: number | null; discountPct: number | null;
  availableUntil: string | null; owned: boolean;
}

interface ShopPackage {
  id: string; name: string; description: string;
  priceCredits: number | null; effectivePrice: number | null;
  premiumCents: number | null; discountPct: number | null;
  availableUntil: string | null;
  skins: { id: string; name: string; type: string; visual: Record<string, unknown> }[];
  allOwned: boolean;
}

interface PremiumItem {
  type: string; name: string; description: string;
  priceCents: number; category: string;
}

interface Entitlement { id: string; itemType: string; itemName: string; consumed: boolean; purchasedAt: string; }

interface SkinsData {
  ownedSkins: SkinDefinition[];
  equipped: { shipSkinId: string | null; stationSkinId: string | null; fleetSkinId: string | null };
  shopSkins: ShopSkin[]; shopPackages: ShopPackage[]; playerCredits: number;
}

export interface ShopMapPanelProps {
  onClose: () => void;
  onEquippedChange?: (equipped: { shipSkinId: string | null; stationSkinId: string | null; fleetSkinId: string | null }) => void;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fmtUsd(cents: number) { return `$${(cents / 100).toFixed(2)}`; }
function fmtCr(n: number) { return n.toLocaleString() + " cr"; }

function RarityBadge({ rarity }: { rarity: string }) {
  const color = RARITY_COLOR[rarity as SkinRarity] ?? "#9ca3af";
  const label = RARITY_LABEL[rarity as SkinRarity] ?? rarity;
  return (
    <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border"
      style={{ color, borderColor: color + "44", background: color + "11" }}>
      {label}
    </span>
  );
}

function SkinPreview({ visual, type, size = 32 }: {
  visual: { color?: string; accentColor?: string; shape?: string };
  type: string; size?: number;
}) {
  const c  = visual.color      ?? (type === "fleet" ? "#c4b5fd" : type === "station" ? "#fbbf24" : "#a5b4fc");
  const ac = visual.accentColor ?? (type === "fleet" ? "#7c3aed" : type === "station" ? "#f59e0b" : "#6366f1");
  const cx = size / 2, cy = size / 2, r = size * 0.28;

  if (type === "station") {
    const s = size * 0.22;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <rect x={cx - s * 1.6} y={cy - s * 0.22} width={s * 3.2} height={s * 0.44} fill={c} rx={1} />
        <rect x={cx - s * 0.22} y={cy - s * 1.6} width={s * 0.44} height={s * 3.2} fill={c} rx={1} />
        <circle cx={cx} cy={cy} r={s * 0.6} fill={ac} />
        {([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2] as number[]).map((a, i) => (
          <circle key={i} cx={cx + Math.cos(a) * s * 1.6} cy={cy + Math.sin(a) * s * 1.6} r={s * 0.45} fill={ac} />
        ))}
      </svg>
    );
  }
  if (type === "fleet") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="#1a0a3d" stroke={ac} strokeWidth={1.5} />
        <polygon points={`${cx},${cy - r * 0.6} ${cx + r * 0.5},${cy + r * 0.35} ${cx - r * 0.5},${cy + r * 0.35}`} fill={c} />
      </svg>
    );
  }
  // ship
  const shape = visual.shape ?? "chevron";
  let pts = "";
  if (shape === "diamond")
    pts = `${cx},${cy - r} ${cx + r * 0.6},${cy} ${cx},${cy + r} ${cx - r * 0.6},${cy}`;
  else if (shape === "arrow")
    pts = `${cx},${cy - r} ${cx + r * 0.55},${cy + r * 0.7} ${cx},${cy + r * 0.3} ${cx - r * 0.55},${cy + r * 0.7}`;
  else if (shape === "delta")
    pts = `${cx},${cy - r * 0.9} ${cx + r * 0.75},${cy + r * 0.85} ${cx - r * 0.75},${cy + r * 0.85}`;
  else
    pts = `${cx},${cy - r} ${cx + r * 0.65},${cy + r * 0.7} ${cx},${cy + r * 0.25} ${cx - r * 0.65},${cy + r * 0.7}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="#1e1b4b" stroke={ac} strokeWidth={1.5} />
      <polygon points={pts} fill={c} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SkinCard
// ---------------------------------------------------------------------------

function SkinCard({ skin, onBuy, buying }: {
  skin: ShopSkin;
  onBuy: (id: string) => void;
  buying: boolean;
}) {
  const hasDiscount = skin.discountPct != null && skin.discountPct > 0;
  const expiresIn = skin.availableUntil
    ? Math.ceil((new Date(skin.availableUntil).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 hover:border-zinc-700 transition-all">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg border border-zinc-700/50 bg-zinc-950 p-1.5">
          <SkinPreview visual={skin.visual} type={skin.type} size={36} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-bold text-zinc-100 truncate">{skin.name}</p>
            <RarityBadge rarity={skin.rarity} />
          </div>
          <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{skin.description}</p>
        </div>
      </div>

      {expiresIn != null && expiresIn <= 7 && (
        <p className="text-[9px] text-amber-500 font-medium">⏰ Expires in {expiresIn}d</p>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        {hasDiscount ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-600 line-through">{fmtCr(skin.priceCredits)}</span>
            <span className="text-xs font-bold text-emerald-400">{fmtCr(skin.effectivePrice)}</span>
            <span className="rounded bg-emerald-900/40 border border-emerald-800/40 px-1 py-0.5 text-[9px] font-bold text-emerald-400">
              -{skin.discountPct}%
            </span>
          </div>
        ) : (
          <span className="text-xs font-bold text-amber-400">{fmtCr(skin.effectivePrice)}</span>
        )}
        {skin.owned ? (
          <span className="rounded-full border border-emerald-800/50 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">Owned</span>
        ) : (
          <button
            onClick={() => onBuy(skin.id)}
            disabled={buying}
            className="rounded-lg px-2.5 py-1 text-xs font-bold transition-all disabled:opacity-50 border border-amber-700/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40"
          >
            {buying ? "…" : "Buy"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PackageCard
// ---------------------------------------------------------------------------

function PackageCard({ pkg, onBuy, buying }: {
  pkg: ShopPackage; onBuy: (id: string) => void; buying: boolean;
}) {
  const hasDiscount = pkg.discountPct != null && pkg.discountPct > 0;
  const expiresIn = pkg.availableUntil
    ? Math.ceil((new Date(pkg.availableUntil).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-violet-900/50 bg-gradient-to-br from-violet-950/20 to-zinc-900/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-zinc-100">{pkg.name}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">{pkg.description}</p>
        </div>
        <span className="shrink-0 rounded-full border border-violet-800/50 bg-violet-950/30 px-1.5 py-0.5 text-[9px] font-bold text-violet-400 uppercase tracking-widest">Bundle</span>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {pkg.skins.map((s) => (
          <div key={s.id} title={s.name} className="rounded border border-zinc-700/50 bg-zinc-950 p-1">
            <SkinPreview visual={s.visual as Parameters<typeof SkinPreview>[0]["visual"]} type={s.type} size={24} />
          </div>
        ))}
      </div>

      {expiresIn != null && expiresIn <= 7 && (
        <p className="text-[9px] text-amber-500 font-medium">⏰ Expires in {expiresIn}d</p>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        {pkg.priceCredits != null ? (
          hasDiscount ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-600 line-through">{fmtCr(pkg.priceCredits)}</span>
              <span className="text-xs font-bold text-emerald-400">{fmtCr(pkg.effectivePrice!)}</span>
              <span className="rounded bg-emerald-900/40 border border-emerald-800/40 px-1 py-0.5 text-[9px] font-bold text-emerald-400">-{pkg.discountPct}%</span>
            </div>
          ) : (
            <span className="text-xs font-bold text-amber-400">{fmtCr(pkg.priceCredits)}</span>
          )
        ) : pkg.premiumCents != null ? (
          <span className="text-xs font-bold text-amber-400">{fmtUsd(pkg.premiumCents)}</span>
        ) : null}

        {pkg.allOwned ? (
          <span className="rounded-full border border-emerald-800/50 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">Owned</span>
        ) : (
          <button
            onClick={() => onBuy(pkg.id)}
            disabled={buying}
            className="rounded-lg px-2.5 py-1 text-xs font-bold transition-all disabled:opacity-50 border border-amber-700/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40"
          >
            {buying ? "…" : "Buy Bundle"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Premium item card (unchanged from before)
// ---------------------------------------------------------------------------

function PremiumItemCard({ item }: { item: PremiumItem }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCosmetic = item.category === "cosmetic";

  async function handleBuy() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/game/shop/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType: item.type }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error?.message ?? "Purchase failed."); return; }
      window.location.href = json.data.url;
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  }

  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 ${
      isCosmetic ? "border-violet-900/50 bg-violet-950/10" : "border-sky-900/50 bg-sky-950/10"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold text-zinc-100">{item.name}</p>
        <span className="shrink-0 font-mono text-xs font-bold text-amber-400">{fmtUsd(item.priceCents)}</span>
      </div>
      <p className="text-[10px] text-zinc-500 flex-1">{item.description}</p>
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border ${
          isCosmetic ? "border-violet-800/50 text-violet-400" : "border-sky-800/50 text-sky-400"
        }`}>{isCosmetic ? "Cosmetic" : "Single-use"}</span>
        <div className="flex flex-col items-end gap-1">
          <button onClick={handleBuy} disabled={loading}
            className="rounded-lg px-2.5 py-1 text-xs font-bold disabled:opacity-50 border border-amber-700/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40">
            {loading ? "…" : "Buy →"}
          </button>
          {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wardrobe tab — equip owned skins
// ---------------------------------------------------------------------------

function WardrobeTab({ skinsData, onEquip }: {
  skinsData: SkinsData;
  onEquip: (slot: "ship" | "station" | "fleet", skinId: string | null) => Promise<void>;
}) {
  const [equipping, setEquipping] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<"ship" | "station" | "fleet">("ship");

  const slotSkins = skinsData.ownedSkins.filter((s) => s.type === activeSlot);
  const equipped = activeSlot === "ship" ? skinsData.equipped.shipSkinId
    : activeSlot === "station" ? skinsData.equipped.stationSkinId
    : skinsData.equipped.fleetSkinId;

  async function doEquip(skinId: string | null) {
    setEquipping(skinId ?? "none");
    await onEquip(activeSlot, skinId);
    setEquipping(null);
  }

  return (
    <div className="space-y-4">
      {/* Slot selector */}
      <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
        {(["ship", "station", "fleet"] as const).map((slot) => (
          <button key={slot} onClick={() => setActiveSlot(slot)}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors capitalize ${
              activeSlot === slot ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}>
            {slot}
          </button>
        ))}
      </div>

      {slotSkins.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-zinc-600">No {activeSlot} skins owned.</p>
          <p className="text-[10px] text-zinc-700 mt-1">Visit the Skins shop tab to purchase some.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Default option */}
          <div className={`flex items-center gap-3 rounded-lg border p-2.5 transition-all cursor-pointer ${
            !equipped ? "border-indigo-700/60 bg-indigo-950/20" : "border-zinc-800 hover:border-zinc-700"
          }`} onClick={() => doEquip(null)}>
            <div className="w-9 h-9 rounded border border-zinc-700/50 bg-zinc-950 flex items-center justify-center">
              <SkinPreview
                visual={{}}
                type={activeSlot}
                size={32}
              />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-zinc-200">Default</p>
              <p className="text-[10px] text-zinc-600">Standard marker</p>
            </div>
            {!equipped && <span className="text-[10px] text-indigo-400 font-medium">Equipped</span>}
          </div>

          {slotSkins.map((skin) => {
            const isEquipped = equipped === skin.id;
            return (
              <div key={skin.id}
                className={`flex items-center gap-3 rounded-lg border p-2.5 transition-all cursor-pointer ${
                  isEquipped ? "border-indigo-700/60 bg-indigo-950/20" : "border-zinc-800 hover:border-zinc-700"
                }`}
                onClick={() => !equipping && doEquip(isEquipped ? null : skin.id)}>
                <div className="w-9 h-9 rounded border border-zinc-700/50 bg-zinc-950 flex items-center justify-center">
                  <SkinPreview visual={skin.visual} type={skin.type} size={32} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-zinc-200 truncate">{skin.name}</p>
                    <RarityBadge rarity={skin.rarity} />
                  </div>
                </div>
                {equipping === skin.id ? (
                  <span className="text-[10px] text-zinc-500 animate-pulse">…</span>
                ) : isEquipped ? (
                  <span className="text-[10px] text-indigo-400 font-medium">Equipped</span>
                ) : (
                  <span className="text-[10px] text-zinc-600 hover:text-zinc-400">Equip</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ShopMapPanel({ onClose, onEquippedChange }: ShopMapPanelProps) {
  const [tab, setTab] = useState<"skins" | "packages" | "premium" | "wardrobe">("skins");
  const [skinsData, setSkinsData] = useState<SkinsData | null>(null);
  const [premiumData, setPremiumData] = useState<{ catalog: PremiumItem[]; entitlements: Entitlement[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [buyMsg, setBuyMsg] = useState<string | null>(null);

  const loadSkins = useCallback(async () => {
    const r = await fetch("/api/game/skins");
    const j = await r.json();
    if (j.ok) {
      setSkinsData(j.data as SkinsData);
      onEquippedChange?.(j.data.equipped);
    }
  }, [onEquippedChange]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/game/skins").then((r) => r.json()),
      fetch("/api/game/shop/panel").then((r) => r.json()),
    ])
      .then(([sj, pj]) => {
        if (sj.ok) { setSkinsData(sj.data as SkinsData); onEquippedChange?.(sj.data.equipped); }
        if (pj.ok) setPremiumData(pj.data as { catalog: PremiumItem[]; entitlements: Entitlement[] });
        if (!sj.ok && !pj.ok) setError("Failed to load shop.");
      })
      .catch(() => setError("Network error."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleBuySkin(skinId: string) {
    setBuying(skinId); setBuyMsg(null);
    try {
      const r = await fetch("/api/game/skins/buy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skinId }),
      });
      const j = await r.json();
      if (j.ok) {
        setBuyMsg(`Purchased ${j.data.name}!`);
        await loadSkins();
      } else {
        setBuyMsg(j.error?.message ?? j.error ?? "Purchase failed.");
      }
    } catch { setBuyMsg("Network error."); }
    finally { setBuying(null); }
  }

  async function handleBuyPackage(packageId: string) {
    setBuying(packageId); setBuyMsg(null);
    try {
      const r = await fetch("/api/game/skins/buy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId }),
      });
      const j = await r.json();
      if (j.ok) {
        setBuyMsg(`Purchased bundle! (${j.data.newSkinsGranted} new skins added)`);
        await loadSkins();
      } else {
        setBuyMsg(j.error?.message ?? j.error ?? "Purchase failed.");
      }
    } catch { setBuyMsg("Network error."); }
    finally { setBuying(null); }
  }

  async function handleEquip(slot: "ship" | "station" | "fleet", skinId: string | null) {
    await fetch("/api/game/skins/equip", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, skinId }),
    });
    await loadSkins();
  }

  const ownedCount = skinsData?.ownedSkins.length ?? 0;

  const tabs = [
    { id: "skins" as const,     label: "Skins" },
    { id: "packages" as const,  label: "Bundles" },
    { id: "wardrobe" as const,  label: `Wardrobe${ownedCount > 0 ? ` (${ownedCount})` : ""}` },
    { id: "premium" as const,   label: "Premium" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-zinc-700/80 bg-zinc-950 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="shrink-0 border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-950 px-5 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Shop</h2>
              <p className="mt-0.5 text-[10px] text-zinc-600">
                {skinsData && `${skinsData.playerCredits.toLocaleString()} credits available`}
              </p>
            </div>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none mt-0.5">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex border-b border-zinc-800 px-4 pt-2 gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                tab === t.id
                  ? "bg-zinc-800 text-zinc-200 border-b-2 border-amber-600"
                  : "text-zinc-600 hover:text-zinc-400"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Buy message */}
        {buyMsg && (
          <div className={`shrink-0 px-4 py-2 text-xs font-medium border-b ${
            buyMsg.includes("!") || buyMsg.includes("added")
              ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-400"
              : "bg-red-950/30 border-red-900/40 text-red-400"
          }`}>
            {buyMsg}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <p className="text-xs text-zinc-600 uppercase tracking-widest animate-pulse">Loading…</p>
            </div>
          )}
          {error && <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-400 text-center">{error}</div>}

          {/* Skins shop */}
          {!loading && !error && tab === "skins" && skinsData && (
            <div className="space-y-3">
              {skinsData.shopSkins.length === 0 ? (
                <p className="py-12 text-center text-sm text-zinc-600">No skins in the shop right now.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {skinsData.shopSkins.map((s) => (
                    <SkinCard key={s.id} skin={s}
                      onBuy={handleBuySkin} buying={buying === s.id} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bundles */}
          {!loading && !error && tab === "packages" && skinsData && (
            <div className="space-y-3">
              {skinsData.shopPackages.length === 0 ? (
                <p className="py-12 text-center text-sm text-zinc-600">No bundles available right now.</p>
              ) : (
                skinsData.shopPackages.map((pkg) => (
                  <PackageCard key={pkg.id} pkg={pkg}
                    onBuy={handleBuyPackage} buying={buying === pkg.id} />
                ))
              )}
            </div>
          )}

          {/* Wardrobe */}
          {!loading && !error && tab === "wardrobe" && skinsData && (
            <WardrobeTab skinsData={skinsData} onEquip={handleEquip} />
          )}

          {/* Premium items */}
          {!loading && !error && tab === "premium" && premiumData && (
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-500">Cosmetics</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {premiumData.catalog.filter((i) => i.category === "cosmetic").map((item) => (
                    <PremiumItemCard key={item.type} item={item} />
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-sky-500">Utility</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {premiumData.catalog.filter((i) => i.category === "utility").map((item) => (
                    <PremiumItemCard key={item.type} item={item} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
