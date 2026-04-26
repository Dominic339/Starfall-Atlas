"use client";

import { useState } from "react";
import { BALANCE_KEYS, type BalanceKey } from "@/lib/config/balanceOverrides";
import { BALANCE } from "@/lib/config/balance";

interface Override { key: string; value: unknown; description: string; updated_at: string; }

// Drill into BALANCE using dot-notation to get the current value
function getDefaultValue(key: string): unknown {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursor: any = BALANCE;
  for (const p of parts) {
    if (cursor == null) return undefined;
    cursor = cursor[p];
  }
  return cursor;
}

function OverrideEditor({ bk, existing, onSave, onDelete }: {
  bk: BalanceKey;
  existing: Override | undefined;
  onSave: (key: string, value: unknown, desc: string) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}) {
  const defaultVal = getDefaultValue(bk.key);
  const [open,  setOpen]  = useState(false);
  const [raw,   setRaw]   = useState(() => existing ? JSON.stringify(existing.value) : JSON.stringify(defaultVal));
  const [desc,  setDesc]  = useState(existing?.description ?? "");
  const [saving,setSaving]= useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { setError("Invalid JSON"); return; }
    setSaving(true); setError(null);
    try {
      await onSave(bk.key, parsed, desc);
      setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm(`Remove override for "${bk.key}"? Will revert to default.`)) return;
    setSaving(true);
    await onDelete(bk.key);
    setSaving(false);
    setOpen(false);
  }

  const hasOverride = !!existing;

  return (
    <div className={`rounded-lg border transition-all ${
      hasOverride ? "border-amber-900/50 bg-amber-950/10" : "border-zinc-800 bg-zinc-900/20"
    }`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold text-zinc-200">{bk.label}</p>
            {hasOverride && (
              <span className="rounded-full bg-amber-900/40 border border-amber-800/40 text-amber-400 text-[9px] font-bold px-1.5 py-0.5">OVERRIDDEN</span>
            )}
          </div>
          <p className="text-[10px] text-zinc-600 mt-0.5 font-mono">{bk.key}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">{bk.description}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-zinc-600">default</p>
          <p className="text-xs font-mono text-zinc-400 max-w-32 truncate">{JSON.stringify(defaultVal)}</p>
          {hasOverride && (
            <>
              <p className="text-[10px] text-amber-600 mt-0.5">override</p>
              <p className="text-xs font-mono text-amber-400 max-w-32 truncate">{JSON.stringify(existing?.value)}</p>
            </>
          )}
        </div>
        <span className="text-zinc-600 text-xs shrink-0">{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              New Value <span className="text-zinc-700 normal-case">(JSON — e.g. 15.5 or [0,10,25] or {`{"key":"val"}`})</span>
            </label>
            <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={3}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-indigo-600 focus:outline-none resize-none" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Reason / notes</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. buffing for weekend event"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-between items-center gap-2">
            {hasOverride ? (
              <button onClick={handleDelete} disabled={saving}
                className="text-xs text-red-500 hover:text-red-300 disabled:opacity-40">
                Remove override (revert to default)
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="px-3 py-1 text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-3 py-1 text-xs font-bold rounded-lg border border-amber-700/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40 disabled:opacity-50">
                {saving ? "Saving…" : "Apply Override"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BalanceTab({ initial }: { initial: Override[] }) {
  const [overrides, setOverrides] = useState<Override[]>(initial);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function showMsg(text: string, ok: boolean) {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3000);
  }

  async function refresh() {
    const r = await fetch("/api/game/admin/balance");
    const j = await r.json();
    if (j.ok) setOverrides(j.data);
  }

  async function handleSave(key: string, value: unknown, description: string) {
    const r = await fetch("/api/game/admin/balance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, description }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error?.message ?? "Save failed");
    await refresh();
    showMsg(`Override applied: ${key}`, true);
  }

  async function handleDelete(key: string) {
    const r = await fetch("/api/game/admin/balance", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const j = await r.json();
    if (j.ok) { await refresh(); showMsg(`Override removed: ${key}`, true); }
    else showMsg(j.error?.message ?? "Delete failed", false);
  }

  const overrideMap = new Map(overrides.map((o) => [o.key, o]));
  const categories = [...new Set(BALANCE_KEYS.map((k) => k.category))];
  const q = filter.toLowerCase();
  const filtered = BALANCE_KEYS.filter(
    (k) => !q || k.key.toLowerCase().includes(q) || k.label.toLowerCase().includes(q) || k.category.toLowerCase().includes(q),
  );
  const filteredCategories = categories.filter((c) => filtered.some((k) => k.category === c));
  const activeOverrideCount = overrides.length;

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-lg border px-4 py-2 text-xs font-medium ${
          msg.ok ? "border-emerald-900/40 bg-emerald-950/20 text-emerald-400" : "border-red-900/40 bg-red-950/20 text-red-400"
        }`}>{msg.text}</div>
      )}

      <div className="flex items-center gap-3">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter balance keys…"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-700 focus:border-indigo-600 focus:outline-none" />
        {activeOverrideCount > 0 && (
          <span className="rounded-full border border-amber-800/50 bg-amber-950/30 px-2.5 py-1 text-xs font-bold text-amber-400">
            {activeOverrideCount} active override{activeOverrideCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <p className="text-[10px] text-zinc-600">
        Overrides take effect within 60 seconds (server cache TTL). Removing an override reverts to the static default immediately.
      </p>

      {filteredCategories.map((cat) => (
        <div key={cat} className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 pt-2">{cat}</p>
          {filtered.filter((k) => k.category === cat).map((bk) => (
            <OverrideEditor key={bk.key} bk={bk}
              existing={overrideMap.get(bk.key)}
              onSave={handleSave} onDelete={handleDelete} />
          ))}
        </div>
      ))}
    </div>
  );
}
