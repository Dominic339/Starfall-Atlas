"use client";

import { useState } from "react";

export interface ShipClassRow {
  id: string; name: string; description: string; rarity: string;
  base_speed_ly_per_hr: number; base_cargo_cap: number;
  max_speed_tier: number | null; max_cargo_tier: number | null;
  icon_variant: string; purchase_cost_credits: number;
  is_available: boolean; sort_order: number;
}

const RARITY_COLOR: Record<string, string> = {
  common: "#9ca3af", uncommon: "#34d399", rare: "#818cf8", legendary: "#fbbf24",
};
const SHAPES = ["chevron", "diamond", "arrow", "delta"] as const;

function ShipClassEditor({ existing, onSave, onClose }: {
  existing: ShipClassRow | null;
  onSave: (data: ShipClassRow) => Promise<void>;
  onClose: () => void;
}) {
  const [id,           setId]           = useState(existing?.id           ?? "");
  const [name,         setName]         = useState(existing?.name         ?? "");
  const [description,  setDesc]         = useState(existing?.description  ?? "");
  const rarity = "common"; // All ships use the same base stats; cosmetic variety comes from skins
  const [speed,        setSpeed]        = useState(existing?.base_speed_ly_per_hr ?? 10);
  const [cargo,        setCargo]        = useState(existing?.base_cargo_cap       ?? 100);
  const [maxSpeedTier, setMaxSpeedTier] = useState<string>(existing?.max_speed_tier != null ? String(existing.max_speed_tier) : "");
  const [maxCargoTier, setMaxCargoTier] = useState<string>(existing?.max_cargo_tier != null ? String(existing.max_cargo_tier) : "");
  const [icon,         setIcon]         = useState(existing?.icon_variant  ?? "chevron");
  const [cost,         setCost]         = useState(existing?.purchase_cost_credits ?? 0);
  const [available,    setAvailable]    = useState(existing?.is_available  ?? true);
  const [sortOrder,    setSortOrder]    = useState(existing?.sort_order    ?? 0);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleSave() {
    if (!id.trim())   { setError("ID required"); return; }
    if (!name.trim()) { setError("Name required"); return; }
    setSaving(true); setError(null);
    try {
      await onSave({
        id: id.trim(), name: name.trim(), description: description.trim(),
        rarity, base_speed_ly_per_hr: speed, base_cargo_cap: cargo,
        max_speed_tier: maxSpeedTier !== "" ? parseInt(maxSpeedTier) : null,
        max_cargo_tier: maxCargoTier !== "" ? parseInt(maxCargoTier) : null,
        icon_variant: icon, purchase_cost_credits: cost,
        is_available: available, sort_order: sortOrder,
      });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="shrink-0 border-b border-zinc-800 px-5 py-3 flex justify-between items-center">
          <h3 className="text-sm font-bold text-zinc-100">{existing ? "Edit Ship Class" : "New Ship Class"}</h3>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2 sm:col-span-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">ID (slug)</label>
              <input value={id} onChange={(e) => setId(e.target.value)} disabled={!!existing}
                placeholder="e.g. scout_mk2"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none disabled:opacity-40" />
            </div>
            <div className="space-y-1 col-span-2 sm:col-span-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Display Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Description</label>
              <textarea value={description} onChange={(e) => setDesc(e.target.value)} rows={2}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none resize-none" />
            </div>
          </div>

          {/* Design note */}
          <div className="rounded-lg border border-indigo-900/30 bg-indigo-950/10 px-3 py-2 text-[10px] text-indigo-400/70">
            ✦ All ship classes use the same base stats. Visual variety comes from skins, not ship rarity.
            Ships are randomly named when players receive them.
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Base Speed (ly/hr)</label>
              <input type="number" step="0.1" min="0.1" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value) || 1)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Base Cargo Cap</label>
              <input type="number" min="1" value={cargo} onChange={(e) => setCargo(parseInt(e.target.value) || 1)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Max Speed Tier</label>
              <input type="number" min="0" value={maxSpeedTier} onChange={(e) => setMaxSpeedTier(e.target.value)} placeholder="global default"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Max Cargo Tier</label>
              <input type="number" min="0" value={maxCargoTier} onChange={(e) => setMaxCargoTier(e.target.value)} placeholder="global default"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
          </div>

          {/* Icon + shop */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Icon Shape</label>
              <select value={icon} onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none">
                {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Purchase Cost (cr)</label>
              <input type="number" min="0" value={cost} onChange={(e) => setCost(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Sort Order</label>
              <input type="number" value={sortOrder} onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer pt-1">
            <div className={`w-10 h-5 rounded-full relative transition-colors ${available ? "bg-emerald-600" : "bg-zinc-700"}`}
              onClick={() => setAvailable((v) => !v)}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${available ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
            <span className="text-xs font-medium text-zinc-300">
              {available ? "Available in shipyard" : "Hidden / disabled"}
            </span>
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="shrink-0 border-t border-zinc-800 px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs font-bold rounded-lg border border-indigo-700/60 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/50 disabled:opacity-50">
            {saving ? "Saving…" : existing ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShipsTab({ initial }: { initial: ShipClassRow[] }) {
  const [classes, setClasses] = useState<ShipClassRow[]>(initial);
  const [editing, setEditing] = useState<ShipClassRow | null | "new">(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function showMsg(text: string, ok: boolean) {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3000);
  }

  async function refresh() {
    const r = await fetch("/api/game/admin/ships");
    const j = await r.json();
    if (j.ok) setClasses(j.data);
  }

  async function handleSave(data: ShipClassRow) {
    const r = await fetch("/api/game/admin/ships", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error?.message ?? "Save failed");
    await refresh();
    showMsg("Ship class saved.", true);
  }

  async function handleDelete(id: string) {
    if (!confirm(`Delete ship class "${id}"?`)) return;
    const r = await fetch("/api/game/admin/ships", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const j = await r.json();
    if (j.ok) { setClasses((c) => c.filter((x) => x.id !== id)); showMsg("Deleted.", true); }
    else showMsg(j.error?.message ?? "Delete failed", false);
  }

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`rounded-lg border px-4 py-2 text-xs font-medium ${
          msg.ok ? "border-emerald-900/40 bg-emerald-950/20 text-emerald-400" : "border-red-900/40 bg-red-950/20 text-red-400"
        }`}>{msg.text}</div>
      )}

      <div className="flex justify-end">
        <button onClick={() => setEditing("new")}
          className="rounded-lg px-3 py-1.5 text-xs font-bold border border-indigo-700/50 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-900/40 transition-all">
          + New Ship Class
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/40">
              {["Class", "Speed", "Cargo", "Max Tiers", "Shape", "Cost", "Status", ""].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => (
              <tr key={c.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
                <td className="px-3 py-2.5">
                  <p className="font-semibold text-zinc-200">{c.name}</p>
                  <p className="text-[10px] text-zinc-600">{c.id}</p>
                </td>
                <td className="px-3 py-2.5 text-zinc-300 font-mono">{c.base_speed_ly_per_hr} ly/hr</td>
                <td className="px-3 py-2.5 text-zinc-300 font-mono">{c.base_cargo_cap}</td>
                <td className="px-3 py-2.5 text-zinc-500">
                  Spd: {c.max_speed_tier ?? "—"} / Cargo: {c.max_cargo_tier ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-zinc-500 capitalize">{c.icon_variant}</td>
                <td className="px-3 py-2.5 text-amber-400 font-mono">
                  {c.purchase_cost_credits > 0 ? `${c.purchase_cost_credits.toLocaleString()} cr` : "Free"}
                </td>
                <td className="px-3 py-2.5">
                  {c.is_available
                    ? <span className="text-[9px] font-semibold rounded-full bg-emerald-900/40 border border-emerald-800/40 text-emerald-400 px-1.5 py-0.5">Live</span>
                    : <span className="text-[9px] font-semibold rounded-full bg-zinc-800/60 border border-zinc-700/40 text-zinc-600 px-1.5 py-0.5">Hidden</span>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1.5 justify-end">
                    <button onClick={() => setEditing(c)}
                      className="rounded px-2 py-0.5 text-[10px] border border-indigo-800/50 text-indigo-400 hover:bg-indigo-950/40">Edit</button>
                    <button onClick={() => handleDelete(c.id)}
                      className="rounded px-2 py-0.5 text-[10px] border border-red-900/40 text-red-500 hover:bg-red-950/20">Del</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ShipClassEditor
          existing={editing === "new" ? null : editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
