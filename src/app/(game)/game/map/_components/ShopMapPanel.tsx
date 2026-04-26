"use client";

import { useState, useEffect, useCallback } from "react";
import type { SkinDefinition, SkinRarity } from "@/skins";
import { RARITY_COLOR, RARITY_LABEL } from "@/skins";

// ---------------------------------------------------------------------------
// Battle Pass tab (self-contained — fetches its own data)
// ---------------------------------------------------------------------------

interface BpTier {
  id: string; tier: number; quest_label: string; quest_type: string;
  free_reward_type: string; free_reward_config: Record<string, unknown>;
  premium_reward_type: string | null; premium_reward_config: Record<string, unknown>;
}
interface BpPass {
  id: string; name: string; description: string; season_number: number;
  max_tier: number; xp_per_tier: number; starts_at: string; ends_at: string;
  premium_cost_credits: number | null;
}
interface BpProgress { current_tier: number; xp_points: number; is_premium: boolean; }

function rewardLabel(type: string, cfg: Record<string, unknown>): string {
  if (type === "credits") return `${(cfg.amount as number | undefined ?? 0).toLocaleString()} CR`;
  if (type === "resource") return `${cfg.quantity ?? "?"} ${String(cfg.resource_type ?? "resource").replace("_", " ")}`;
  if (type === "skin") return String(cfg.skin_id ?? "skin").replace(/_/g, " ");
  if (type === "ship_class") return String(cfg.class_id ?? "ship class").replace(/_/g, " ");
  if (type === "title") return `"${cfg.title ?? "title"}"`;
  return type;
}

function rewardIcon(type: string): string {
  if (type === "credits") return "◈";
  if (type === "resource") return "⬡";
  if (type === "skin") return "✦";
  if (type === "ship_class") return "▲";
  if (type === "title") return "❋";
  return "•";
}

function BattlePassTab() {
  const [pass, setPass] = useState<BpPass | null>(null);
  const [progress, setProgress] = useState<BpProgress | null>(null);
  const [tiers, setTiers] = useState<BpTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    fetch("/api/game/battle-pass/status")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) { setPass(j.data.pass); setProgress(j.data.progress); setTiers(j.data.tiers); }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade() {
    if (!pass) return;
    setUpgrading(true);
    const r = await fetch("/api/game/battle-pass/upgrade", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passId: pass.id }),
    });
    const j = await r.json();
    if (j.ok) {
      setProgress((p) => p ? { ...p, is_premium: true } : p);
      setMsg({ text: "Upgraded to Premium!", ok: true });
    } else {
      setMsg({ text: j.error?.message ?? "Upgrade failed", ok: false });
    }
    setUpgrading(false);
    setTimeout(() => setMsg(null), 3000);
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-amber-700/40 border-t-amber-400 animate-spin" />
      <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Loading pass…</p>
    </div>
  );

  if (!pass || !progress) {
    return (
      <div className="py-16 text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-2xl mx-auto">🌌</div>
        <p className="text-sm font-semibold text-zinc-400">No Active Battle Pass</p>
        <p className="text-xs text-zinc-600">Check back next season for new rewards.</p>
      </div>
    );
  }

  const xpPct = Math.min(100, Math.round((progress.xp_points / pass.xp_per_tier) * 100));
  const endsIn = Math.max(0, Math.round((new Date(pass.ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  const isPrem = progress.is_premium;

  return (
    <div className="space-y-0">
      {msg && (
        <div className={`mx-0 mb-3 rounded-lg border px-3 py-2 text-xs font-medium ${msg.ok ? "border-emerald-900/40 bg-emerald-950/20 text-emerald-400" : "border-red-900/40 bg-red-950/20 text-red-400"}`}>
          {msg.text}
        </div>
      )}

      {/* ── Season header banner ── */}
      <div className="relative overflow-hidden rounded-xl mb-3"
        style={{ background: "linear-gradient(135deg, #1c1440 0%, #0f172a 40%, #1a1a2e 70%, #1c1440 100%)" }}>
        {/* Decorative stars */}
        <div className="absolute inset-0 pointer-events-none">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="absolute w-0.5 h-0.5 rounded-full bg-white opacity-40"
              style={{ left: `${(i * 37 + 11) % 100}%`, top: `${(i * 53 + 7) % 100}%` }} />
          ))}
        </div>
        <div className="relative p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500/80">Season {pass.season_number}</span>
                <span className="text-[9px] text-zinc-600">·</span>
                <span className="text-[9px] text-zinc-500">{endsIn}d left</span>
              </div>
              <p className="text-sm font-bold text-white leading-tight">{pass.name}</p>
              {pass.description && <p className="text-[10px] text-zinc-400 mt-0.5">{pass.description}</p>}
            </div>
            {isPrem ? (
              <div className="shrink-0 rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider"
                style={{ background: "linear-gradient(135deg,#92400e,#b45309)", color: "#fde68a", border: "1px solid #f59e0b60" }}>
                ⭐ PREMIUM
              </div>
            ) : (
              <button onClick={handleUpgrade} disabled={upgrading}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50 transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg,#92400e,#d97706)", color: "#fef3c7", border: "1px solid #f59e0b70", boxShadow: "0 0 12px #f59e0b30" }}>
                {upgrading ? "…" : `⬆ Upgrade${pass.premium_cost_credits ? ` · ${pass.premium_cost_credits.toLocaleString()} cr` : ""}`}
              </button>
            )}
          </div>

          {/* XP bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[9px]">
              <span className="text-zinc-400 font-medium">Tier {progress.current_tier} <span className="text-zinc-600">/ {pass.max_tier}</span></span>
              <span className="text-zinc-500">{progress.xp_points.toLocaleString()} <span className="text-zinc-700">/ {pass.xp_per_tier.toLocaleString()} XP</span></span>
            </div>
            <div className="h-3 rounded-full overflow-hidden relative" style={{ background: "#0f172a", border: "1px solid #334155" }}>
              <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                style={{
                  width: `${xpPct}%`,
                  background: "linear-gradient(90deg, #d97706, #fbbf24, #fde68a)",
                  boxShadow: xpPct > 0 ? "0 0 8px #f59e0b80" : "none",
                }} />
              {xpPct > 0 && (
                <div className="absolute inset-y-0 rounded-full opacity-50"
                  style={{ left: `${Math.max(0, xpPct - 8)}%`, width: "8%", background: "linear-gradient(90deg, transparent, #fff8)" }} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Horizontal tier track ── */}
      {tiers.length === 0 ? (
        <p className="py-8 text-center text-xs text-zinc-600">No tiers configured for this pass.</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 px-0.5">Reward Track</p>

          {/* Premium row header */}
          {tiers.some((t) => t.premium_reward_type) && (
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="h-px flex-1 bg-amber-900/30" />
              <span className="text-[8px] font-bold text-amber-700/80 uppercase tracking-widest">⭐ Premium</span>
              <div className="h-px flex-1 bg-amber-900/30" />
            </div>
          )}

          {/* Scrollable tier cards */}
          <div className="overflow-x-auto -mx-1 px-1 pb-2">
            <div className="flex gap-2" style={{ width: "max-content" }}>
              {tiers.map((t) => {
                const unlocked = progress.current_tier >= t.tier;
                const current  = progress.current_tier === t.tier - 1;
                return (
                  <div key={t.id} className="flex flex-col gap-1.5 items-center" style={{ width: 72 }}>

                    {/* Premium reward card */}
                    {t.premium_reward_type ? (
                      <div className={`w-full rounded-lg p-1.5 text-center transition-all border ${
                        isPrem && unlocked
                          ? "border-amber-700/60 bg-gradient-to-b from-amber-950/60 to-amber-900/20"
                          : "border-zinc-800/60 bg-zinc-900/20 opacity-50"
                      }`}
                        style={isPrem && unlocked ? { boxShadow: "0 0 8px #f59e0b20" } : {}}>
                        <div className="text-base leading-none mb-0.5 text-amber-400">
                          {rewardIcon(t.premium_reward_type)}
                        </div>
                        <p className="text-[8px] font-medium text-amber-300/80 leading-tight break-words">
                          {rewardLabel(t.premium_reward_type, t.premium_reward_config)}
                        </p>
                      </div>
                    ) : (
                      <div className="w-full rounded-lg border border-transparent bg-transparent" style={{ height: 52 }} />
                    )}

                    {/* Tier connector + number */}
                    <div className="relative flex items-center justify-center w-full">
                      {t.tier > 1 && (
                        <div className="absolute right-full h-0.5 w-3"
                          style={{ background: unlocked ? "#f59e0b50" : "#27272a" }} />
                      )}
                      <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[9px] font-bold transition-all z-10 ${
                        unlocked
                          ? "border-amber-600 bg-amber-950 text-amber-300"
                          : current
                            ? "border-indigo-600 bg-indigo-950 text-indigo-300 ring-2 ring-indigo-500/30"
                            : "border-zinc-700 bg-zinc-900 text-zinc-600"
                      }`}
                        style={unlocked ? { boxShadow: "0 0 6px #f59e0b50" } : current ? { boxShadow: "0 0 8px #6366f150" } : {}}>
                        {unlocked ? "✓" : t.tier}
                      </div>
                      {t.tier < tiers.length && (
                        <div className="absolute left-full h-0.5 w-3"
                          style={{ background: unlocked ? "#f59e0b50" : "#27272a" }} />
                      )}
                    </div>

                    {/* Free reward card */}
                    <div className={`w-full rounded-lg p-1.5 text-center transition-all border ${
                      unlocked
                        ? "border-indigo-800/60 bg-gradient-to-b from-indigo-950/60 to-indigo-900/20"
                        : current
                          ? "border-zinc-700 bg-zinc-900/60"
                          : "border-zinc-800/40 bg-zinc-900/10 opacity-60"
                    }`}
                      style={unlocked ? { boxShadow: "0 0 6px #6366f120" } : {}}>
                      <div className={`text-base leading-none mb-0.5 ${unlocked ? "text-indigo-400" : "text-zinc-600"}`}>
                        {rewardIcon(t.free_reward_type)}
                      </div>
                      <p className={`text-[8px] font-medium leading-tight break-words ${unlocked ? "text-zinc-300" : "text-zinc-600"}`}>
                        {rewardLabel(t.free_reward_type, t.free_reward_config)}
                      </p>
                    </div>

                    {/* Quest label */}
                    <p className="text-[7px] text-zinc-700 text-center leading-tight w-full truncate px-0.5" title={t.quest_label}>
                      {t.quest_label || `T${t.tier}`}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [tab, setTab] = useState<"skins" | "packages" | "premium" | "wardrobe" | "battlepass">("skins");
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
    { id: "skins" as const,      label: "Skins" },
    { id: "packages" as const,   label: "Bundles" },
    { id: "wardrobe" as const,   label: `Wardrobe${ownedCount > 0 ? ` (${ownedCount})` : ""}` },
    { id: "premium" as const,    label: "Premium" },
    { id: "battlepass" as const, label: "Battle Pass" },
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

          {/* Battle Pass */}
          {tab === "battlepass" && <BattlePassTab />}

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
