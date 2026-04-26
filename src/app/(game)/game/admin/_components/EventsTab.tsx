"use client";

import { useState } from "react";

export interface LiveEventRow {
  id: string; name: string; description: string; type: string;
  config: Record<string, unknown>; starts_at: string; ends_at: string;
  is_active: boolean; system_ids: string[] | null;
  entry_cost_credits: number | null; entry_cost_premium: number | null;
  created_at: string; updated_at: string;
  nodes?: { id: string; resource_type: string; remaining_amount: number; status: string }[];
}

const EVENT_TYPES = [
  { id: "special_asteroid",  label: "Special Asteroid",  desc: "Spawn temporary asteroid nodes with rare/custom resources" },
  { id: "harvest_boost",     label: "Harvest Boost",     desc: "Multiply asteroid harvest rate during the event window" },
  { id: "credit_bonus",      label: "Credit Bonus",      desc: "Grant bonus credits for specified player activities" },
  { id: "resource_node",     label: "Resource Node",     desc: "Spawn gatherable resource deposits in selected systems" },
  { id: "double_drop",       label: "Double Drop",       desc: "Double resource yield from colonies and/or asteroids" },
  { id: "currency_event",    label: "Currency Event",    desc: "Premium-currency gated event with exclusive rewards" },
] as const;

type EventType = typeof EVENT_TYPES[number]["id"];

function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 16);
}
function fromDateTimeLocal(val: string): string | null {
  if (!val) return null;
  return new Date(val).toISOString();
}

// Config forms per event type
function ConfigForm({ type, config, onChange }: {
  type: EventType;
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}) {
  function set(key: string, val: unknown) { onChange({ ...config, [key]: val }); }

  if (type === "harvest_boost") return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Multiplier</label>
      <input type="number" step="0.1" min="1" value={(config.multiplier as number) ?? 2}
        onChange={(e) => set("multiplier", parseFloat(e.target.value) || 2)}
        className="w-32 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
      <p className="text-[10px] text-zinc-500">e.g. 2 = double harvest rate</p>
    </div>
  );

  if (type === "credit_bonus") return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Bonus Credits on Activity</label>
      <input type="number" min="0" value={(config.credits as number) ?? 100}
        onChange={(e) => set("credits", parseInt(e.target.value) || 0)}
        className="w-32 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
      <div className="space-y-1 mt-2">
        <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Trigger</label>
        <select value={(config.trigger as string) ?? "colony_tax"}
          onChange={(e) => set("trigger", e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none">
          <option value="colony_tax">Colony tax collected</option>
          <option value="asteroid_harvest">Asteroid harvest completed</option>
          <option value="market_trade">Market trade executed</option>
          <option value="travel">Travel jump completed</option>
        </select>
      </div>
    </div>
  );

  if (type === "double_drop") return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Applies To</label>
      <div className="flex gap-3">
        {(["colonies", "asteroids", "both"] as const).map((v) => (
          <label key={v} className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" value={v} checked={(config.applies_to ?? "both") === v}
              onChange={() => set("applies_to", v)}
              className="accent-indigo-500" />
            <span className="text-xs text-zinc-300 capitalize">{v}</span>
          </label>
        ))}
      </div>
    </div>
  );

  if (type === "currency_event") return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Reward Description</label>
      <input value={(config.reward_description as string) ?? ""} onChange={(e) => set("reward_description", e.target.value)}
        placeholder="e.g. Exclusive Void Runner skin + 500 bonus credits"
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
    </div>
  );

  // special_asteroid and resource_node share a nodes-based config
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-zinc-500">
        Configure spawned nodes below in the <strong>Nodes</strong> section.
        Resource type, system, and quantity are specified per node.
      </p>
    </div>
  );
}

// Node builder for asteroid/resource events
interface NodeDef {
  system_id: string; resource_type: string; total_amount: number;
  display_offset_x: number; display_offset_y: number;
}

const RESOURCE_TYPES = ["iron", "carbon", "ice", "silica", "water", "biomass", "sulfur", "rare_crystal", "exotic_matter", "crystalline_core", "void_dust"];

function NodesBuilder({ nodes, onChange }: { nodes: NodeDef[]; onChange: (n: NodeDef[]) => void }) {
  function addNode() {
    onChange([...nodes, { system_id: "", resource_type: "rare_crystal", total_amount: 500, display_offset_x: 0, display_offset_y: 0 }]);
  }
  function removeNode(i: number) { onChange(nodes.filter((_, idx) => idx !== i)); }
  function updateNode(i: number, key: keyof NodeDef, val: string | number) {
    const next = [...nodes];
    next[i] = { ...next[i], [key]: val };
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Nodes ({nodes.length})</label>
        <button onClick={addNode}
          className="rounded px-2 py-0.5 text-[10px] font-bold border border-indigo-800/50 text-indigo-400 hover:bg-indigo-950/30">
          + Add Node
        </button>
      </div>
      {nodes.map((n, i) => (
        <div key={i} className="grid grid-cols-12 gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
          <input value={n.system_id} onChange={(e) => updateNode(i, "system_id", e.target.value)}
            placeholder="System ID" className="col-span-4 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:outline-none" />
          <select value={n.resource_type} onChange={(e) => updateNode(i, "resource_type", e.target.value)}
            className="col-span-4 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:outline-none">
            {RESOURCE_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input type="number" value={n.total_amount} onChange={(e) => updateNode(i, "total_amount", parseInt(e.target.value) || 0)}
            placeholder="Amount" className="col-span-3 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:outline-none" />
          <button onClick={() => removeNode(i)} className="col-span-1 text-red-600 hover:text-red-400 text-xs">✕</button>
        </div>
      ))}
    </div>
  );
}

function EventEditor({ existing, onSave, onClose }: {
  existing: LiveEventRow | null;
  onSave: (data: Record<string, unknown>, nodes: NodeDef[]) => Promise<void>;
  onClose: () => void;
}) {
  const [name,       setName]       = useState(existing?.name        ?? "");
  const [description,setDesc]       = useState(existing?.description  ?? "");
  const [type,       setType]       = useState<EventType>((existing?.type as EventType) ?? "special_asteroid");
  const [config,     setConfig]     = useState<Record<string, unknown>>(existing?.config ?? {});
  const [startsAt,   setStartsAt]   = useState(toDateTimeLocal(existing?.starts_at));
  const [endsAt,     setEndsAt]     = useState(toDateTimeLocal(existing?.ends_at));
  const [isActive,   setIsActive]   = useState(existing?.is_active   ?? false);
  const [systemIds,  setSystemIds]  = useState((existing?.system_ids ?? []).join(", "));
  const [entryCr,    setEntryCr]    = useState<string>(existing?.entry_cost_credits != null ? String(existing.entry_cost_credits) : "");
  const [entryPrem,  setEntryPrem]  = useState<string>(existing?.entry_cost_premium  != null ? String(existing.entry_cost_premium)  : "");
  const [nodes,      setNodes]      = useState<NodeDef[]>([]);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const needsNodes = type === "special_asteroid" || type === "resource_node";

  async function handleSave() {
    if (!name.trim())    { setError("Name required"); return; }
    if (!startsAt)       { setError("Start time required"); return; }
    if (!endsAt)         { setError("End time required"); return; }
    setSaving(true); setError(null);
    try {
      const sysIds = systemIds.split(",").map((s) => s.trim()).filter(Boolean);
      await onSave({
        ...(existing?.id ? { id: existing.id } : {}),
        name: name.trim(), description: description.trim(), type, config,
        starts_at: fromDateTimeLocal(startsAt), ends_at: fromDateTimeLocal(endsAt),
        is_active: isActive,
        system_ids: sysIds.length > 0 ? sysIds : null,
        entry_cost_credits: entryCr !== "" ? parseInt(entryCr) : null,
        entry_cost_premium: entryPrem !== "" ? parseInt(entryPrem) : null,
      }, nodes);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }}>
      <div className="w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="shrink-0 border-b border-zinc-800 px-5 py-3 flex justify-between items-center">
          <h3 className="text-sm font-bold text-zinc-100">{existing ? "Edit Event" : "New Live Event"}</h3>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Event Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Description (shown to players)</label>
              <textarea value={description} onChange={(e) => setDesc(e.target.value)} rows={2}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none resize-none" />
            </div>
          </div>

          {/* Event type */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Event Type</label>
            <div className="grid grid-cols-2 gap-1.5">
              {EVENT_TYPES.map((et) => (
                <button key={et.id} onClick={() => { setType(et.id as EventType); setConfig({}); }}
                  className={`text-left rounded-lg border px-3 py-2 transition-all ${
                    type === et.id
                      ? "border-indigo-700/60 bg-indigo-950/30 text-indigo-200"
                      : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400"
                  }`}>
                  <p className="text-xs font-semibold">{et.label}</p>
                  <p className="text-[9px] mt-0.5 opacity-70">{et.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Type-specific config */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-2">Event Config</p>
            <ConfigForm type={type} config={config} onChange={setConfig} />
          </div>

          {/* Node builder */}
          {needsNodes && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
              <NodesBuilder nodes={nodes} onChange={setNodes} />
            </div>
          )}

          {/* Scheduling */}
          <div className="grid grid-cols-2 gap-3">
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

          {/* System targeting */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Target System IDs <span className="text-zinc-700 normal-case">(comma-separated, blank = all)</span>
            </label>
            <input value={systemIds} onChange={(e) => setSystemIds(e.target.value)} placeholder="e.g. sol, alpha-centauri"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-600 focus:outline-none" />
          </div>

          {/* Entry costs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Entry Cost (credits)</label>
              <input type="number" min="0" value={entryCr} onChange={(e) => setEntryCr(e.target.value)} placeholder="Free"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Entry Cost (premium ¢)</label>
              <input type="number" min="0" value={entryPrem} onChange={(e) => setEntryPrem(e.target.value)} placeholder="Free"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-600 focus:outline-none" />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div className={`w-10 h-5 rounded-full relative transition-colors ${isActive ? "bg-emerald-600" : "bg-zinc-700"}`}
              onClick={() => setIsActive((v) => !v)}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isActive ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
            <span className="text-xs font-medium text-zinc-300">{isActive ? "Event live now" : "Scheduled / inactive"}</span>
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="shrink-0 border-t border-zinc-800 px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs font-bold rounded-lg border border-indigo-700/60 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/50 disabled:opacity-50">
            {saving ? "Saving…" : existing ? "Update Event" : "Create Event"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventStatusBadge({ event }: { event: LiveEventRow }) {
  const now = Date.now();
  const start = new Date(event.starts_at).getTime();
  const end   = new Date(event.ends_at).getTime();
  if (!event.is_active) return <span className="text-[9px] font-bold rounded-full border border-zinc-700 bg-zinc-800/50 text-zinc-500 px-1.5 py-0.5">Inactive</span>;
  if (now < start)      return <span className="text-[9px] font-bold rounded-full border border-sky-900/50 bg-sky-950/30 text-sky-400 px-1.5 py-0.5">Scheduled</span>;
  if (now > end)        return <span className="text-[9px] font-bold rounded-full border border-zinc-700 bg-zinc-800/50 text-zinc-500 px-1.5 py-0.5">Ended</span>;
  return <span className="text-[9px] font-bold rounded-full border border-emerald-800/50 bg-emerald-950/30 text-emerald-400 px-1.5 py-0.5">Live</span>;
}

export function EventsTab({ initial }: { initial: LiveEventRow[] }) {
  const [events,  setEvents]  = useState<LiveEventRow[]>(initial);
  const [editing, setEditing] = useState<LiveEventRow | null | "new">(null);
  const [msg,     setMsg]     = useState<{ text: string; ok: boolean } | null>(null);

  function showMsg(text: string, ok: boolean) {
    setMsg({ text, ok }); setTimeout(() => setMsg(null), 3000);
  }

  async function refresh() {
    const r = await fetch("/api/game/admin/events");
    const j = await r.json();
    if (j.ok) setEvents(j.data);
  }

  async function handleSave(data: Record<string, unknown>, nodes: NodeDef[]) {
    const r = await fetch("/api/game/admin/events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, nodes: nodes.length > 0 ? nodes : undefined }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error?.message ?? "Save failed");
    await refresh(); showMsg("Event saved.", true);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this event? Spawned nodes will also be removed.")) return;
    const r = await fetch("/api/game/admin/events", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const j = await r.json();
    if (j.ok) { setEvents((e) => e.filter((x) => x.id !== id)); showMsg("Event deleted.", true); }
    else showMsg(j.error?.message ?? "Delete failed", false);
  }

  const eventTypeLabel = (t: string) => EVENT_TYPES.find((e) => e.id === t)?.label ?? t;

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
          + New Event
        </button>
      </div>

      {events.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-600">No events yet. Create one to run a special in-game event.</p>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => (
            <div key={ev.id} className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-zinc-100">{ev.name}</p>
                    <EventStatusBadge event={ev} />
                    <span className="text-[9px] rounded border border-zinc-700 bg-zinc-800/40 text-zinc-500 px-1.5 py-0.5">
                      {eventTypeLabel(ev.type)}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{ev.description}</p>
                </div>
                <div className="text-right shrink-0 text-[10px] text-zinc-600 space-y-0.5">
                  <p>Start: {new Date(ev.starts_at).toLocaleString()}</p>
                  <p>End:   {new Date(ev.ends_at).toLocaleString()}</p>
                </div>
              </div>

              {ev.nodes && ev.nodes.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {ev.nodes.map((n) => (
                    <span key={n.id} className={`rounded border px-1.5 py-0.5 text-[9px] ${
                      n.status === "active" ? "border-emerald-900/40 text-emerald-400" : "border-zinc-700 text-zinc-600"
                    }`}>
                      {n.resource_type} × {n.remaining_amount} ({n.status})
                    </span>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-1.5 pt-1">
                <button onClick={() => setEditing(ev)}
                  className="rounded px-2.5 py-1 text-[10px] font-medium border border-indigo-800/50 text-indigo-400 hover:bg-indigo-950/30">Edit</button>
                <button onClick={() => handleDelete(ev.id)}
                  className="rounded px-2.5 py-1 text-[10px] font-medium border border-red-900/40 text-red-500 hover:bg-red-950/20">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EventEditor
          existing={editing === "new" ? null : editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
