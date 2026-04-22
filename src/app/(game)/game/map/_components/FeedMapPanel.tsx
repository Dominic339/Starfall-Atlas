"use client";

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types (mirrors FeedEvent from /game/feed)
// ---------------------------------------------------------------------------

interface FeedEvent {
  id: string;
  eventType: string;
  label: string;
  playerHandle: string | null;
  systemId: string | null;
  systemName: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

interface FeedMapPanelProps { onClose: () => void; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EVENT_COLOR: Record<string, string> = {
  system_discovered:       "text-indigo-400",
  colony_founded:          "text-emerald-400",
  colony_abandoned:        "text-amber-400",
  colony_collapsed:        "text-red-400",
  colony_reactivated:      "text-emerald-300",
  colony_sold:             "text-orange-400",
  system_sold:             "text-orange-400",
  alliance_formed:         "text-violet-400",
  alliance_dissolved:      "text-zinc-400",
  lane_built:              "text-sky-400",
  gate_built:              "text-sky-300",
  gate_neutralized:        "text-amber-500",
  gate_reclaimed:          "text-emerald-500",
  stewardship_registered:  "text-teal-400",
  stewardship_transferred: "text-teal-300",
  majority_control_gained: "text-rose-400",
  majority_control_lost:   "text-rose-300",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeedMapPanel({ onClose }: FeedMapPanelProps) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    fetch("/api/game/feed?limit=50")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setEvents(json.data.events as FeedEvent[]);
          setHasMore((json.data.events as FeedEvent[]).length === 50);
        } else {
          setFetchError("Failed to load feed.");
        }
      })
      .catch(() => setFetchError("Network error."))
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    const oldest = events[events.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/game/feed?limit=50&before=${encodeURIComponent(oldest.occurredAt)}`);
      const json = await res.json();
      if (json.ok) {
        const next = json.data.events as FeedEvent[];
        setEvents((prev) => [...prev, ...next]);
        setHasMore(next.length === 50);
      }
    } catch {}
    finally { setLoadingMore(false); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      <div className="relative w-full max-w-xl max-h-[85vh] flex flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">World Feed</h2>
            <p className="text-xs text-zinc-600">Major events across the galaxy</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-3">
          {loading && <p className="text-xs text-zinc-600 text-center py-12">Loading events…</p>}
          {fetchError && <p className="text-xs text-red-400 text-center py-12">{fetchError}</p>}

          {!loading && !fetchError && events.length === 0 && (
            <p className="text-xs text-zinc-600 text-center py-12">No events yet.</p>
          )}

          {!loading && events.map((e) => {
            const color = EVENT_COLOR[e.eventType] ?? "text-zinc-400";
            return (
              <div key={e.id} className="flex items-start gap-3 py-2.5 border-b border-zinc-800/50 last:border-0">
                <span className={`mt-1 w-1.5 h-1.5 shrink-0 rounded-full bg-current ${color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-300">
                    {e.playerHandle && (
                      <span className="font-medium text-zinc-100">{e.playerHandle} </span>
                    )}
                    <span className={color}>{e.label}</span>
                    {e.systemName && (
                      <span className="text-zinc-500"> · {e.systemName}</span>
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-zinc-600">{timeAgo(e.occurredAt)}</span>
              </div>
            );
          })}

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50 transition-colors border border-zinc-800 rounded"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
