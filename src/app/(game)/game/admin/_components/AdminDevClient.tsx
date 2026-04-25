"use client";

import { useState, useCallback } from "react";
import type { SkinDefinition } from "@/skins";
import { RARITY_COLOR, RARITY_LABEL } from "@/skins";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbSkinRow {
  id: string; name: string; description: string; type: string; rarity: string;
  price_credits: number; price_premium_cents: number | null;
  discount_pct: number | null; is_available: boolean;
  available_from: string | null; available_until: string | null;
  created_at: string; updated_at: string;
}

export interface DbPackageRow {
  id: string; name: string; description: string;
  price_credits: number | null; price_premium_cents: number | null;
  discount_pct: number | null; is_available: boolean;
  available_from: string | null; available_until: string | null;
  skinIds: string[]; created_at: string; updated_at: string;
}

interface Props {
  dbSkins: DbSkinRow[];
  packages: DbPackageRow[];
  allSkinDefs: SkinDefinition[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 16); // YYYY-MM-DDTHH:mm
}

function fromDateTimeLocal(val: string): string | null {
  if (!val) return null;
  return new Date(val).toISOString();
}

function RarityDot({ rarity }: { rarity: string }) {
  const color = RARITY_COLOR[rarity as keyof typeof RARITY_COLOR] ?? "#9ca3af";
  return <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: color }} />;
}

// ---------------------------------------------------------------------------
// SkinEditor — modal for editing a single skin's shop configuration
// ---------------------------------------------------------------------------

interface SkinEditorProps {
  def: SkinDefinition;
  existing: DbSkinRow | undefined;
  onSave: (data: Partial<DbSkinRow>) => Promise<void>;
  onClose: () => void;
}

function SkinEditor({ def, existing, onSave, onClose }: SkinEditorProps) {
  const [priceCredits,      setPriceCredits]      = useState(existing?.price_credits      ?? 500);
  const [premiumCents,      setPremiumCents]       = useState(existing?.price_premium_cents ?? null as number | null);
  const [discountPct,       setDiscountPct]        = useState(existing?.discount_pct       ?? null as number | null);
  const [isAvailable,       setIsAvailable]        = useState(existing?.is_available       ?? false);
  const [availableFrom,     setAvailableFrom]      = useState(toDateTimeLocal(existing?.available_from ?? null));
  const [availableUntil,    setAvailableUntil]     = useState(toDateTimeLocal(existing?.available_until ?? null));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      await onSave({
        id: def.id, name: def.name, description: def.description,
        type: def.type, rarity: def.rarity,
        price_credits: priceCredits,
        price_premium_cents: premiumCents,
        discount_pct: discountPct,
        is_available: isAvailable,
        available_from: fromDateTimeLocal(availableFrom),
        available_until: fromDateTimeLocal(availableUntil),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  }

  const effectivePrice = discountPct != null
    ? Math.round(priceCredits * (1 - discountPct / 100))
    : priceCredits;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="shrink-0 border-b border-zinc-800 px-5 py-3.5 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-zinc-100">{def.name}</h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              <RarityDot rarity={def.rarity} />
              {RARITY_LABEL[def.rarity as keyof typeof RARITY_LABEL]} · {def.type}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Availability toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className={`w-10 h-5 rounded-full transition-colors relative ${isAvailable ? "bg-emerald-600" : "bg-zinc-700"}`}
              onClick={() => setIsAvailable((v) => !v)}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isAvailable ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
            <span className="text-xs font-medium text-zinc-300">
              {isAvailable ? "Listed in shop" : "Hidden from shop"}
            </span>
          </label>

          {/* Credit price */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Credit Price</label>
            <input type="number" min={0} value={priceCredits}
              onChange={(e) => setPriceCredits(parseInt(e.target.value) || 0)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
          </div>

          {/* Discount */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Discount % <span className="text-zinc-700 normal-case">(leave blank = no discount)</span>
            </label>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={100}
                value={discountPct ?? ""}
                onChange={(e) => setDiscountPct(e.target.value ? parseInt(e.target.value) : null)}
                placeholder="e.g. 20"
                className="w-32 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
              {discountPct != null && (
                <span className="text-xs text-emerald-400">
                  Effective: <strong>{effectivePrice.toLocaleString()}</strong> cr
                  <span className="text-zinc-600 ml-1">(was {priceCredits.toLocaleString()})</span>
                </span>
              )}
            </div>
          </div>

          {/* Premium price */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Premium Price (USD cents) <span className="text-zinc-700 normal-case">(optional)</span>
            </label>
            <input type="number" min={0}
              value={premiumCents ?? ""}
              onChange={(e) => setPremiumCents(e.target.value ? parseInt(e.target.value) : null)}
              placeholder="e.g. 299 = $2.99"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
          </div>

          {/* Time window */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Available From</label>
              <input type="datetime-local" value={availableFrom}
                onChange={(e) => setAvailableFrom(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Available Until</label>
              <input type="datetime-local" value={availableUntil}
                onChange={(e) => setAvailableUntil(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
              {availableUntil && (
                <p className="text-[9px] text-amber-500">
                  Expires in ~{Math.ceil((new Date(availableUntil).getTime() - Date.now()) / 86400000)}d
                </p>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="shrink-0 border-t border-zinc-800 px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs font-bold rounded-lg border border-indigo-700/60 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/50 disabled:opacity-50 transition-all">
            {saving ? "Saving…" : existing ? "Update" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PackageEditor
// ---------------------------------------------------------------------------

interface PackageEditorProps {
  existing: DbPackageRow | null;
  allSkins: SkinDefinition[];
  dbSkins: DbSkinRow[];
  onSave: (data: Partial<DbPackageRow> & { skinIds: string[] }) => Promise<void>;
  onClose: () => void;
}

function PackageEditor({ existing, allSkins, dbSkins, onSave, onClose }: PackageEditorProps) {
  const [pkgId,         setPkgId]         = useState(existing?.id          ?? "");
  const [name,          setName]           = useState(existing?.name        ?? "");
  const [description,   setDescription]   = useState(existing?.description  ?? "");
  const [priceCredits,  setPriceCredits]  = useState(existing?.price_credits ?? null as number | null);
  const [premiumCents,  setPremiumCents]  = useState(existing?.price_premium_cents ?? null as number | null);
  const [discountPct,   setDiscountPct]   = useState(existing?.discount_pct  ?? null as number | null);
  const [isAvailable,   setIsAvailable]   = useState(existing?.is_available  ?? false);
  const [availableFrom, setAvailableFrom] = useState(toDateTimeLocal(existing?.available_from ?? null));
  const [availableUntil,setAvailableUntil]= useState(toDateTimeLocal(existing?.available_until ?? null));
  const [selectedSkins, setSelectedSkins] = useState<Set<string>>(new Set(existing?.skinIds ?? []));
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  function toggleSkin(id: string) {
    setSelectedSkins((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const effectivePrice = priceCredits != null && discountPct != null
    ? Math.round(priceCredits * (1 - discountPct / 100))
    : priceCredits;

  async function handleSave() {
    if (!pkgId.trim()) { setError("ID is required"); return; }
    if (!name.trim())  { setError("Name is required"); return; }
    setSaving(true); setError(null);
    try {
      await onSave({
        id: pkgId.trim(), name: name.trim(), description: description.trim(),
        price_credits: priceCredits, price_premium_cents: premiumCents,
        discount_pct: discountPct, is_available: isAvailable,
        available_from: fromDateTimeLocal(availableFrom),
        available_until: fromDateTimeLocal(availableUntil),
        skinIds: Array.from(selectedSkins),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  }

  const dbSkinIds = new Set(dbSkins.map((s) => s.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="shrink-0 border-b border-zinc-800 px-5 py-3.5 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-100">{existing ? "Edit Bundle" : "New Bundle"}</h3>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Bundle ID (slug)</label>
              <input value={pkgId} onChange={(e) => setPkgId(e.target.value)} disabled={!!existing}
                placeholder="e.g. starter_pack"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none disabled:opacity-40" />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Display Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none resize-none" />
            </div>
          </div>

          {/* Skins in bundle */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Skins in Bundle <span className="text-zinc-700 normal-case">({selectedSkins.size} selected)</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
              {allSkins.map((skin) => {
                const inDb = dbSkinIds.has(skin.id);
                const selected = selectedSkins.has(skin.id);
                return (
                  <button key={skin.id} onClick={() => toggleSkin(skin.id)}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-all text-xs ${
                      selected
                        ? "border border-indigo-700/60 bg-indigo-950/30 text-zinc-100"
                        : "border border-transparent bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800"
                    }`}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: RARITY_COLOR[skin.rarity as keyof typeof RARITY_COLOR] ?? "#9ca3af" }} />
                    <span className="truncate">{skin.name}</span>
                    {!inDb && <span className="ml-auto text-[9px] text-zinc-600">not in DB</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Credit Price</label>
              <input type="number" min={0} value={priceCredits ?? ""}
                onChange={(e) => setPriceCredits(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Discount %</label>
              <input type="number" min={0} max={100} value={discountPct ?? ""}
                onChange={(e) => setDiscountPct(e.target.value ? parseInt(e.target.value) : null)}
                placeholder="0–100"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
          </div>
          {priceCredits != null && discountPct != null && (
            <p className="text-xs text-emerald-400">
              Effective: <strong>{effectivePrice?.toLocaleString()}</strong> cr
            </p>
          )}

          {/* Time window */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Available From</label>
              <input type="datetime-local" value={availableFrom}
                onChange={(e) => setAvailableFrom(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Available Until</label>
              <input type="datetime-local" value={availableUntil}
                onChange={(e) => setAvailableUntil(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
          </div>

          {/* Availability toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className={`w-10 h-5 rounded-full transition-colors relative ${isAvailable ? "bg-emerald-600" : "bg-zinc-700"}`}
              onClick={() => setIsAvailable((v) => !v)}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isAvailable ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
            <span className="text-xs font-medium text-zinc-300">
              {isAvailable ? "Listed in shop" : "Hidden from shop"}
            </span>
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="shrink-0 border-t border-zinc-800 px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs font-bold rounded-lg border border-indigo-700/60 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/50 disabled:opacity-50">
            {saving ? "Saving…" : existing ? "Update Bundle" : "Create Bundle"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AdminDevClient
// ---------------------------------------------------------------------------

export function AdminDevClient({ dbSkins: initialDbSkins, packages: initialPackages, allSkinDefs }: Props) {
  const [tab, setTab] = useState<"skins" | "packages">("skins");
  const [dbSkins, setDbSkins] = useState<DbSkinRow[]>(initialDbSkins);
  const [packages, setPackages] = useState<DbPackageRow[]>(initialPackages);
  const [editingSkin, setEditingSkin] = useState<SkinDefinition | null>(null);
  const [editingPkg, setEditingPkg] = useState<DbPackageRow | "new" | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const dbSkinMap = new Map(dbSkins.map((s) => [s.id, s]));

  function showMsg(text: string, ok: boolean) {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3000);
  }

  const saveSkin = useCallback(async (data: Partial<DbSkinRow>) => {
    const r = await fetch("/api/game/skins/admin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "skin", ...data }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error?.message ?? "Save failed");
    // Reload
    const lr = await fetch("/api/game/skins/admin");
    const lj = await lr.json();
    if (lj.ok) setDbSkins(lj.data.dbSkins);
    showMsg("Skin saved.", true);
  }, []);

  const savePackage = useCallback(async (data: Partial<DbPackageRow> & { skinIds: string[] }) => {
    const r = await fetch("/api/game/skins/admin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "package", ...data }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error?.message ?? "Save failed");
    const lr = await fetch("/api/game/skins/admin");
    const lj = await lr.json();
    if (lj.ok) setPackages(lj.data.packages);
    showMsg("Bundle saved.", true);
  }, []);

  async function deleteSkin(id: string) {
    if (!confirm(`Delete skin "${id}" from DB? Players who own it keep it, but it won't appear in the shop.`)) return;
    const r = await fetch("/api/game/skins/admin", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "skin", id }),
    });
    const j = await r.json();
    if (j.ok) { setDbSkins((prev) => prev.filter((s) => s.id !== id)); showMsg("Skin removed from DB.", true); }
    else showMsg(j.error?.message ?? "Delete failed", false);
  }

  async function deletePackage(id: string) {
    if (!confirm(`Delete bundle "${id}"?`)) return;
    const r = await fetch("/api/game/skins/admin", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "package", id }),
    });
    const j = await r.json();
    if (j.ok) { setPackages((prev) => prev.filter((p) => p.id !== id)); showMsg("Bundle deleted.", true); }
    else showMsg(j.error?.message ?? "Delete failed", false);
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
          msg.ok ? "border-emerald-900/40 bg-emerald-950/20 text-emerald-400"
                 : "border-red-900/40 bg-red-950/20 text-red-400"
        }`}>{msg.text}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800 pb-0">
        {(["skins", "packages"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium rounded-t transition-colors capitalize ${
              tab === t ? "bg-zinc-800 text-zinc-200 border-b-2 border-red-500" : "text-zinc-600 hover:text-zinc-400"
            }`}>
            {t === "skins" ? `Skin Catalog (${allSkinDefs.length} defs / ${dbSkins.length} in DB)` : `Bundles (${packages.length})`}
          </button>
        ))}
      </div>

      {/* ── Skins tab ── */}
      {tab === "skins" && (
        <div className="space-y-3">
          <p className="text-[10px] text-zinc-600">
            Skin definitions come from <code className="text-zinc-500">src/skins/index.ts</code>.
            Publishing a skin writes it to the DB and makes it available in the shop when toggled on.
          </p>

          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/40">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Skin</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Type</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Price</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Discount</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Shop</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {allSkinDefs.map((def) => {
                  const row = dbSkinMap.get(def.id);
                  const inDb = !!row;
                  return (
                    <tr key={def.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <RarityDot rarity={def.rarity} />
                          <span className="font-medium text-zinc-200">{def.name}</span>
                          {!inDb && <span className="rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-600">not in DB</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500 capitalize">{def.type}</td>
                      <td className="px-4 py-2.5 text-right text-amber-400 font-mono">
                        {row ? `${row.price_credits.toLocaleString()} cr` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {row?.discount_pct != null ? (
                          <span className="text-emerald-400">-{row.discount_pct}%</span>
                        ) : <span className="text-zinc-700">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row?.is_available ? (
                          <span className="rounded-full bg-emerald-900/40 border border-emerald-800/40 px-1.5 py-0.5 text-[9px] text-emerald-400 font-semibold">Live</span>
                        ) : (
                          <span className="rounded-full bg-zinc-800/60 border border-zinc-700/40 px-1.5 py-0.5 text-[9px] text-zinc-600">Hidden</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => setEditingSkin(def)}
                            className="rounded px-2 py-1 text-[10px] font-medium border border-indigo-800/50 bg-indigo-950/30 text-indigo-400 hover:bg-indigo-900/40 transition-all">
                            {inDb ? "Edit" : "Publish"}
                          </button>
                          {inDb && (
                            <button onClick={() => deleteSkin(def.id)}
                              className="rounded px-2 py-1 text-[10px] font-medium border border-red-900/40 bg-red-950/20 text-red-500 hover:bg-red-900/30 transition-all">
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Packages tab ── */}
      {tab === "packages" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setEditingPkg("new")}
              className="rounded-lg px-3 py-1.5 text-xs font-bold border border-indigo-700/50 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-900/40 transition-all">
              + New Bundle
            </button>
          </div>

          {packages.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-600">No bundles yet.</p>
          ) : (
            <div className="space-y-3">
              {packages.map((pkg) => (
                <div key={pkg.id} className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-zinc-100">{pkg.name}</p>
                        {pkg.is_available ? (
                          <span className="rounded-full bg-emerald-900/40 border border-emerald-800/40 px-1.5 py-0.5 text-[9px] text-emerald-400 font-semibold">Live</span>
                        ) : (
                          <span className="rounded-full bg-zinc-800/60 border border-zinc-700/40 px-1.5 py-0.5 text-[9px] text-zinc-600">Hidden</span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{pkg.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {pkg.price_credits != null && (
                        <p className="text-xs font-bold text-amber-400">
                          {pkg.discount_pct ? (
                            <><span className="line-through text-zinc-600 mr-1">{pkg.price_credits.toLocaleString()}</span>
                            {Math.round(pkg.price_credits * (1 - pkg.discount_pct / 100)).toLocaleString()} cr</>
                          ) : `${pkg.price_credits.toLocaleString()} cr`}
                        </p>
                      )}
                      {pkg.discount_pct != null && (
                        <p className="text-[10px] text-emerald-400">-{pkg.discount_pct}% off</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {pkg.skinIds.map((sid) => {
                      const def = allSkinDefs.find((d) => d.id === sid);
                      return (
                        <span key={sid} className="rounded border border-zinc-700/50 bg-zinc-800/40 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          <RarityDot rarity={def?.rarity ?? "common"} />{def?.name ?? sid}
                        </span>
                      );
                    })}
                  </div>

                  {(pkg.available_from || pkg.available_until) && (
                    <p className="text-[10px] text-zinc-600">
                      {pkg.available_from && `From: ${new Date(pkg.available_from).toLocaleString()}`}
                      {pkg.available_from && pkg.available_until && " · "}
                      {pkg.available_until && `Until: ${new Date(pkg.available_until).toLocaleString()}`}
                    </p>
                  )}

                  <div className="flex justify-end gap-1.5 pt-1">
                    <button onClick={() => setEditingPkg(pkg)}
                      className="rounded px-2.5 py-1 text-[10px] font-medium border border-indigo-800/50 bg-indigo-950/30 text-indigo-400 hover:bg-indigo-900/40 transition-all">
                      Edit
                    </button>
                    <button onClick={() => deletePackage(pkg.id)}
                      className="rounded px-2.5 py-1 text-[10px] font-medium border border-red-900/40 bg-red-950/20 text-red-500 hover:bg-red-900/30 transition-all">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {editingSkin && (
        <SkinEditor
          def={editingSkin}
          existing={dbSkinMap.get(editingSkin.id)}
          onSave={saveSkin}
          onClose={() => setEditingSkin(null)}
        />
      )}
      {editingPkg && (
        <PackageEditor
          existing={editingPkg === "new" ? null : editingPkg}
          allSkins={allSkinDefs}
          dbSkins={dbSkins}
          onSave={savePackage}
          onClose={() => setEditingPkg(null)}
        />
      )}
    </div>
  );
}
