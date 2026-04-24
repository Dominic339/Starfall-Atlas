"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface ProfileData {
  handle: string;
  title: string | null;
  bio: string | null;
  credits: number;
  joinedAt: string;
  stats: {
    systemsDiscovered: number;
    firstDiscoveries: number;
    activeColonies: number;
    totalShipUpgrades: number;
  };
  alliance: { name: string | null; tag: string | null; role: string | null } | null;
}

interface ProfileMapPanelProps { onClose: () => void; }

function StatTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <span className={`font-mono text-xl font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{label}</span>
    </div>
  );
}

export function ProfileMapPanel({ onClose }: ProfileMapPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  // Edit form state
  const [handle, setHandle] = useState("");
  const [title, setTitle]   = useState("");
  const [bio, setBio]       = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/game/profile/panel")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setData(json.data as ProfileData);
          setHandle(json.data.handle ?? "");
          setTitle(json.data.title ?? "");
          setBio(json.data.bio ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setSaveMsg(null);
    try {
      const res = await fetch("/api/game/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: handle.trim() || undefined,
          title: title.trim() || null,
          bio: bio.trim() || null,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSaveMsg({ ok: true, text: "Profile updated." });
        setEditing(false);
        setData((d) => d ? { ...d, handle: handle.trim() || d.handle, title: title.trim() || null, bio: bio.trim() || null } : d);
        router.refresh();
      } else {
        setSaveMsg({ ok: false, text: json.error?.message ?? "Update failed." });
      }
    } catch {
      setSaveMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="relative w-full max-w-sm max-h-[90vh] flex flex-col rounded-xl border border-zinc-700/80 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden">

        {/* Header */}
        <div className="shrink-0 border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-950 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            {loading ? (
              <div className="w-24 h-6 rounded bg-zinc-800 animate-pulse" />
            ) : (
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-800/80 to-indigo-950 border border-indigo-700/50 flex items-center justify-center shrink-0">
                    <span className="text-base font-bold text-indigo-200">{data?.handle[0]?.toUpperCase()}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-zinc-100 truncate">{data?.handle}</p>
                    {data?.title && <p className="text-[10px] text-zinc-500 truncate">{data.title}</p>}
                  </div>
                </div>
                {data?.alliance && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="rounded border border-violet-800/50 bg-violet-950/30 px-1.5 py-0.5 text-[10px] font-bold text-violet-400">
                      [{data.alliance.tag}] {data.alliance.name}
                    </span>
                    <span className="text-[10px] text-zinc-600 capitalize">{data.alliance.role}</span>
                  </div>
                )}
              </div>
            )}
            <button onClick={onClose} className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none mt-0.5">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && (
            <div className="flex justify-center py-10">
              <p className="text-xs text-zinc-600 animate-pulse uppercase tracking-widest">Loading…</p>
            </div>
          )}

          {!loading && data && (
            <>
              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Systems found"   value={data.stats.systemsDiscovered} color="text-indigo-400" />
                <StatTile label="First contact"   value={data.stats.firstDiscoveries}  color="text-amber-400" />
                <StatTile label="Colonies"        value={data.stats.activeColonies}    color="text-emerald-400" />
                <StatTile label="Ship upgrades"   value={data.stats.totalShipUpgrades} color="text-rose-400" />
              </div>

              {/* Joined */}
              <p className="text-[10px] text-zinc-700">
                Commander since {new Date(data.joinedAt).toLocaleDateString("en-US", { year: "numeric", month: "long" })}
              </p>

              {/* Bio display */}
              {!editing && data.bio && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                  <p className="text-xs text-zinc-500 leading-relaxed whitespace-pre-wrap">{data.bio}</p>
                </div>
              )}

              {/* Edit form */}
              {editing ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 block mb-1">Handle</label>
                    <input
                      value={handle} onChange={(e) => setHandle(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                      maxLength={32}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 block mb-1">Title <span className="text-zinc-700 normal-case">(optional)</span></label>
                    <input
                      value={title} onChange={(e) => setTitle(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                      placeholder="e.g. Galactic Pioneer"
                      maxLength={64}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 block mb-1">Bio <span className="text-zinc-700 normal-case">(optional)</span></label>
                    <textarea
                      rows={3} value={bio} onChange={(e) => setBio(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 resize-none"
                      placeholder="A few words about yourself…"
                      maxLength={512}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleSave} disabled={saving}
                      className="rounded-lg px-4 py-1.5 text-xs font-bold border border-indigo-700/50 bg-indigo-900/30 text-indigo-300 hover:bg-indigo-800/40 disabled:opacity-50 transition-colors">
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => { setEditing(false); setSaveMsg(null); }}
                      className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                      Cancel
                    </button>
                  </div>
                  {saveMsg && (
                    <p className={`text-xs ${saveMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{saveMsg.text}</p>
                  )}
                </div>
              ) : (
                <button onClick={() => setEditing(true)}
                  className="w-full rounded-lg border border-zinc-700/50 bg-zinc-900/40 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors">
                  Edit Profile
                </button>
              )}

              {saveMsg && !editing && (
                <p className={`text-xs text-center ${saveMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{saveMsg.text}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
