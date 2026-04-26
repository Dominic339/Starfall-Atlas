"use client";

import { useState } from "react";
import type { SkinDefinition } from "@/skins";

export interface BattlePassTier {
  id?: string; tier: number;
  quest_label: string; quest_type: string; quest_config: Record<string, unknown>;
  free_reward_type: string; free_reward_config: Record<string, unknown>;
  premium_reward_type: string | null; premium_reward_config: Record<string, unknown>;
}

export interface BattlePassRow {
  id: string; name: string; description: string; season_number: number;
  max_tier: number; xp_per_tier: number;
  starts_at: string; ends_at: string; is_active: boolean;
  premium_cost_credits: number | null; premium_cost_premium: number | null;
  tiers: BattlePassTier[];
}

const QUEST_TYPES = [
  { id: "manual",            label: "Manual (admin unlocks)" },
  { id: "gather_resource",   label: "Gather resource" },
  { id: "travel_jumps",      label: "Travel jumps" },
  { id: "found_colonies",    label: "Found colonies" },
  { id: "harvest_asteroid",  label: "Harvest asteroid" },
  { id: "market_trades",     label: "Market trades" },
  { id: "alliance_activity", label: "Alliance activity" },
];

const REWARD_TYPES = ["credits", "resource", "skin", "ship_class", "title"];

const RESOURCES = ["iron", "titanium", "carbon", "helium", "silica", "rare_earth"];

function toLocal(iso: string | null | undefined) { return iso ? new Date(iso).toISOString().slice(0, 16) : ""; }
function fromLocal(s: string): string | null { return s ? new Date(s).toISOString() : null; }

// ── Quest Config Fields ────────────────────────────────────────────────────────

function QuestConfigFields({ questType, config, onChange }: {
  questType: string;
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}) {
  function set(k: string, v: unknown) { onChange({ ...config, [k]: v }); }

  if (questType === "manual" || questType === "alliance_activity") return null;

  if (questType === "gather_resource") return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Resource</label>
        <select value={(config.resource as string) ?? "iron"}
          onChange={(e) => set("resource", e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none">
          <option value="">Any resource</option>
          {RESOURCES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Amount</label>
        <input type="number" min={1} value={(config.amount as number) ?? 500}
          onChange={(e) => set("amount", parseInt(e.target.value) || 1)}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
      </div>
    </div>
  );

  const countLabel = questType === "travel_jumps" ? "Jumps" : questType === "found_colonies" ? "Colonies" : questType === "market_trades" ? "Trades" : "Amount";
  const countKey = questType === "harvest_asteroid" ? "amount" : "count";
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">{countLabel} Required</label>
      <input type="number" min={1} value={(config[countKey] as number) ?? 1}
        onChange={(e) => onChange({ [countKey]: parseInt(e.target.value) || 1 })}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
    </div>
  );
}

// ── Reward Config Fields ───────────────────────────────────────────────────────

function RewardConfigFields({ rewardType, config, onChange, allSkinDefs }: {
  rewardType: string;
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  allSkinDefs: SkinDefinition[];
}) {
  function set(k: string, v: unknown) { onChange({ ...config, [k]: v }); }

  if (rewardType === "credits") return (
    <div className="space-y-1">
      <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Amount (cr)</label>
      <input type="number" min={1} value={(config.amount as number) ?? 100}
        onChange={(e) => onChange({ amount: parseInt(e.target.value) || 1 })}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
    </div>
  );

  if (rewardType === "resource") return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Resource</label>
        <select value={(config.resource_type as string) ?? "iron"}
          onChange={(e) => set("resource_type", e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none">
          {RESOURCES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Quantity</label>
        <input type="number" min={1} value={(config.quantity as number) ?? 100}
          onChange={(e) => set("quantity", parseInt(e.target.value) || 1)}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
      </div>
    </div>
  );

  if (rewardType === "skin") return (
    <div className="space-y-1">
      <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Skin</label>
      <select value={(config.skin_id as string) ?? ""}
        onChange={(e) => onChange({ skin_id: e.target.value })}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none">
        <option value="">— Pick a skin —</option>
        {allSkinDefs.map((s) => (
          <option key={s.id} value={s.id}>[{s.type}] {s.name} ({s.rarity})</option>
        ))}
      </select>
      {!!config.skin_id && (
        <p className="text-[9px] text-indigo-500 font-mono">{String(config.skin_id)}</p>
      )}
    </div>
  );

  if (rewardType === "ship_class") return (
    <div className="space-y-1">
      <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Class ID</label>
      <input value={(config.class_id as string) ?? ""}
        onChange={(e) => onChange({ class_id: e.target.value })}
        placeholder="e.g. scout_mk1"
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-mono text-zinc-100 focus:border-indigo-600 focus:outline-none" />
    </div>
  );

  if (rewardType === "title") return (
    <div className="space-y-1">
      <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Title Text</label>
      <input value={(config.title as string) ?? ""}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="e.g. Pioneer"
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
    </div>
  );

  return null;
}

// ── Tier Row ──────────────────────────────────────────────────────────────────

function TierRow({ tier, idx, onChange, onRemove, allSkinDefs }: {
  tier: BattlePassTier; idx: number;
  onChange: (t: BattlePassTier) => void;
  onRemove: () => void;
  allSkinDefs: SkinDefinition[];
}) {
  const [open, setOpen] = useState(false);
  function set<K extends keyof BattlePassTier>(k: K, v: BattlePassTier[K]) { onChange({ ...tier, [k]: v }); }

  const rewardSummary = (type: string, cfg: Record<string, unknown>) => {
    if (type === "credits") return `${(cfg.amount as number | undefined ?? 0).toLocaleString()} cr`;
    if (type === "resource") return `${cfg.quantity ?? "?"} × ${cfg.resource_type ?? "?"}`;
    if (type === "skin") return cfg.skin_id as string ?? "skin";
    return type;
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30">
      <div className="flex items-center gap-3 px-3 py-2 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <span className="w-8 h-8 rounded-full border border-zinc-700 bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-300 shrink-0">
          {tier.tier}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-zinc-300 truncate">{tier.quest_label || <span className="text-zinc-600 italic">No quest label</span>}</p>
          <p className="text-[9px] text-zinc-600">
            Free: <span className="text-zinc-500">{rewardSummary(tier.free_reward_type, tier.free_reward_config)}</span>
            {tier.premium_reward_type && <>
              {" · "}Premium: <span className="text-amber-600">{rewardSummary(tier.premium_reward_type, tier.premium_reward_config)}</span>
            </>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-700 text-xs">{open ? "▲" : "▼"}</span>
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-red-700 hover:text-red-400 text-xs px-1">✕</button>
        </div>
      </div>

      {open && (
        <div className="border-t border-zinc-800 px-3 py-3 space-y-3">
          {/* Quest */}
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Quest</label>
            <input value={tier.quest_label} onChange={(e) => set("quest_label", e.target.value)}
              placeholder="e.g. Gather 500 iron"
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            <select value={tier.quest_type}
              onChange={(e) => { set("quest_type", e.target.value); set("quest_config", {}); }}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none">
              {QUEST_TYPES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
            <QuestConfigFields questType={tier.quest_type} config={tier.quest_config}
              onChange={(c) => set("quest_config", c)} />
          </div>

          {/* Free reward */}
          <div className="space-y-2 border-t border-zinc-800 pt-2">
            <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Free Reward</label>
            <select value={tier.free_reward_type}
              onChange={(e) => { set("free_reward_type", e.target.value); set("free_reward_config", {}); }}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none">
              {REWARD_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <RewardConfigFields rewardType={tier.free_reward_type} config={tier.free_reward_config}
              onChange={(c) => set("free_reward_config", c)} allSkinDefs={allSkinDefs} />
          </div>

          {/* Premium reward */}
          <div className="space-y-2 border-t border-zinc-800 pt-2">
            <label className="text-[9px] font-bold uppercase tracking-widest text-amber-700">Premium Reward</label>
            <select value={tier.premium_reward_type ?? ""}
              onChange={(e) => { set("premium_reward_type", e.target.value || null); set("premium_reward_config", {}); }}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none">
              <option value="">None</option>
              {REWARD_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {tier.premium_reward_type && (
              <RewardConfigFields rewardType={tier.premium_reward_type} config={tier.premium_reward_config}
                onChange={(c) => set("premium_reward_config", c)} allSkinDefs={allSkinDefs} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pass Editor ───────────────────────────────────────────────────────────────

function PassEditor({ existing, onSave, onClose, allSkinDefs }: {
  existing: BattlePassRow | null;
  onSave: (data: Record<string, unknown>, tiers: BattlePassTier[]) => Promise<void>;
  onClose: () => void;
  allSkinDefs: SkinDefinition[];
}) {
  const [name,      setName]      = useState(existing?.name        ?? "");
  const [desc,      setDesc]      = useState(existing?.description  ?? "");
  const [season,    setSeason]    = useState(existing?.season_number ?? 1);
  const [maxTier,   setMaxTier]   = useState(existing?.max_tier      ?? 30);
  const [xpPerTier, setXpPerTier] = useState(existing?.xp_per_tier   ?? 1000);
  const [startsAt,  setStartsAt]  = useState(toLocal(existing?.starts_at));
  const [endsAt,    setEndsAt]    = useState(toLocal(existing?.ends_at));
  const [isActive,  setIsActive]  = useState(existing?.is_active     ?? false);
  const [premCr,    setPremCr]    = useState<string>(existing?.premium_cost_credits != null ? String(existing.premium_cost_credits) : "");
  const [tiers,     setTiers]     = useState<BattlePassTier[]>(existing?.tiers ?? []);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  function addTier() {
    const nextNum = (tiers[tiers.length - 1]?.tier ?? 0) + 1;
    setTiers((prev) => [...prev, {
      tier: nextNum, quest_label: "", quest_type: "manual", quest_config: {},
      free_reward_type: "credits", free_reward_config: { amount: 100 },
      premium_reward_type: null, premium_reward_config: {},
    }]);
  }

  function bulkGenerate() {
    if (tiers.length > 0 && !confirm("Replace existing tiers with auto-generated ones?")) return;
    const generated: BattlePassTier[] = Array.from({ length: maxTier }, (_, i) => ({
      tier: i + 1, quest_label: `Tier ${i + 1}`, quest_type: "manual", quest_config: {},
      free_reward_type: "credits", free_reward_config: { amount: (i + 1) * 50 },
      premium_reward_type: i % 5 === 4 ? "credits" : null,
      premium_reward_config: i % 5 === 4 ? { amount: (i + 1) * 200 } : {},
    }));
    setTiers(generated);
  }

  async function handleSave() {
    if (!name.trim()) { setError("Name required"); return; }
    if (!startsAt || !endsAt) { setError("Start and end dates required"); return; }
    setSaving(true); setError(null);
    try {
      await onSave({
        ...(existing?.id ? { id: existing.id } : {}),
        name: name.trim(), description: desc.trim(), season_number: season,
        max_tier: maxTier, xp_per_tier: xpPerTier,
        starts_at: fromLocal(startsAt), ends_at: fromLocal(endsAt), is_active: isActive,
        premium_cost_credits: premCr !== "" ? parseInt(premCr) : null,
        premium_cost_premium: null,
      }, tiers);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }}>
      <div className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="shrink-0 border-b border-zinc-800 px-5 py-3 flex justify-between items-center">
          <h3 className="text-sm font-bold text-zinc-100">{existing ? "Edit Battle Pass" : "New Battle Pass"}</h3>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Season 1: First Contact"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Description</label>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none resize-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Season #</label>
              <input type="number" min="1" value={season} onChange={(e) => setSeason(parseInt(e.target.value) || 1)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Max Tiers</label>
              <input type="number" min="1" max="200" value={maxTier} onChange={(e) => setMaxTier(parseInt(e.target.value) || 30)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">XP per Tier</label>
              <input type="number" min="1" value={xpPerTier} onChange={(e) => setXpPerTier(parseInt(e.target.value) || 1000)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Premium Cost (credits)</label>
              <input type="number" min="0" value={premCr} onChange={(e) => setPremCr(e.target.value)} placeholder="Free pass only"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Starts At</label>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Ends At</label>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div className={`w-10 h-5 rounded-full relative transition-colors ${isActive ? "bg-emerald-600" : "bg-zinc-700"}`}
              onClick={() => setIsActive((v) => !v)}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isActive ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
            <span className="text-xs font-medium text-zinc-300">{isActive ? "Active — visible to players" : "Draft / inactive"}</span>
          </label>

          {/* Tiers */}
          <div className="space-y-2 border-t border-zinc-800 pt-4">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Tiers ({tiers.length} / {maxTier})
              </label>
              <div className="flex gap-2">
                <button onClick={bulkGenerate}
                  className="rounded px-2 py-0.5 text-[10px] font-medium border border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300">
                  Auto-generate {maxTier}
                </button>
                <button onClick={addTier}
                  className="rounded px-2 py-0.5 text-[10px] font-medium border border-indigo-800/50 text-indigo-400 hover:bg-indigo-950/30">
                  + Add Tier
                </button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {tiers.map((t, i) => (
                <TierRow key={i} tier={t} idx={i} allSkinDefs={allSkinDefs}
                  onChange={(updated) => setTiers((prev) => prev.map((x, j) => j === i ? updated : x))}
                  onRemove={() => setTiers((prev) => prev.filter((_, j) => j !== i))} />
              ))}
              {tiers.length === 0 && (
                <p className="py-4 text-center text-xs text-zinc-600">
                  No tiers yet. Add them manually or use Auto-generate.
                </p>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="shrink-0 border-t border-zinc-800 px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs font-bold rounded-lg border border-indigo-700/60 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/50 disabled:opacity-50">
            {saving ? "Saving…" : existing ? "Update Pass" : "Create Pass"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BattlePassTab({ initial, allSkinDefs }: { initial: BattlePassRow[]; allSkinDefs: SkinDefinition[] }) {
  const [passes,  setPasses]  = useState<BattlePassRow[]>(initial);
  const [editing, setEditing] = useState<BattlePassRow | null | "new">(null);
  const [msg,     setMsg]     = useState<{ text: string; ok: boolean } | null>(null);

  function showMsg(text: string, ok: boolean) { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3500); }

  async function refresh() {
    const r = await fetch("/api/game/admin/battle-pass");
    const j = await r.json();
    if (j.ok) setPasses(j.data);
  }

  async function handleSave(data: Record<string, unknown>, tiers: BattlePassTier[]) {
    const r = await fetch("/api/game/admin/battle-pass", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, tiers }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error?.message ?? "Save failed");
    await refresh(); showMsg("Battle pass saved.", true);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this battle pass? Player progress will also be removed.")) return;
    const r = await fetch("/api/game/admin/battle-pass", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const j = await r.json();
    if (j.ok) { setPasses((p) => p.filter((x) => x.id !== id)); showMsg("Deleted.", true); }
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
          className="rounded-lg px-3 py-1.5 text-xs font-bold border border-indigo-700/50 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-900/40">
          + New Battle Pass
        </button>
      </div>

      {passes.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-600">No battle passes yet.</p>
      ) : (
        <div className="space-y-3">
          {passes.map((bp) => {
            const now = Date.now();
            const live = bp.is_active && now >= new Date(bp.starts_at).getTime() && now <= new Date(bp.ends_at).getTime();
            return (
              <div key={bp.id} className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-zinc-100">{bp.name}</p>
                      <span className="text-[9px] border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-500">Season {bp.season_number}</span>
                      {live
                        ? <span className="text-[9px] font-bold rounded-full border border-emerald-800/50 bg-emerald-950/30 text-emerald-400 px-1.5 py-0.5">Live</span>
                        : bp.is_active
                          ? <span className="text-[9px] font-bold rounded-full border border-sky-900/50 bg-sky-950/30 text-sky-400 px-1.5 py-0.5">Scheduled</span>
                          : <span className="text-[9px] font-bold rounded-full border border-zinc-700 bg-zinc-800/50 text-zinc-600 px-1.5 py-0.5">Draft</span>
                      }
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-0.5">{bp.description}</p>
                  </div>
                  <div className="text-right shrink-0 text-[10px] text-zinc-600 space-y-0.5">
                    <p>{bp.max_tier} tiers · {bp.xp_per_tier.toLocaleString()} XP/tier</p>
                    <p>{bp.tiers.length} tier rows defined</p>
                    {bp.premium_cost_credits && <p className="text-amber-600">{bp.premium_cost_credits.toLocaleString()} cr (premium)</p>}
                  </div>
                </div>

                {bp.tiers.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {bp.tiers.slice(0, 10).map((t) => (
                      <span key={t.tier} title={t.quest_label}
                        className="w-6 h-6 rounded border border-zinc-700 bg-zinc-800 flex items-center justify-center text-[9px] text-zinc-500 cursor-default">
                        {t.tier}
                      </span>
                    ))}
                    {bp.tiers.length > 10 && (
                      <span className="w-6 h-6 rounded border border-zinc-700 bg-zinc-800 flex items-center justify-center text-[9px] text-zinc-600">
                        +{bp.tiers.length - 10}
                      </span>
                    )}
                  </div>
                )}

                <div className="text-[10px] text-zinc-600">
                  {new Date(bp.starts_at).toLocaleDateString()} – {new Date(bp.ends_at).toLocaleDateString()}
                </div>

                <div className="flex justify-end gap-1.5 pt-1">
                  <button onClick={() => setEditing(bp)}
                    className="rounded px-2.5 py-1 text-[10px] font-medium border border-indigo-800/50 text-indigo-400 hover:bg-indigo-950/30">Edit</button>
                  <button onClick={() => handleDelete(bp.id)}
                    className="rounded px-2.5 py-1 text-[10px] font-medium border border-red-900/40 text-red-500 hover:bg-red-950/20">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <PassEditor
          existing={editing === "new" ? null : editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          allSkinDefs={allSkinDefs}
        />
      )}
    </div>
  );
}
