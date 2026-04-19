"use client";

import { useState } from "react";

export interface FeedEvent {
  id: string;
  eventType: string;
  label: string;
  playerHandle: string | null;
  systemId: string | null;
  systemName: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

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
  const s  = Math.floor(diff / 1000);
  const m  = Math.floor(s / 60);
  const h  = Math.floor(m / 60);
  const d  = Math.floor(h / 24);
  if (d > 0)  return `${d}d ago`;
  if (h > 0)  return `${h}h ago`;
  if (m > 0)  return `${m}m ago`;
  return "just now";
}

function EventRow({ event }: { event: FeedEvent }) {
  const color = EVENT_COLOR[event.eventType] ?? "text-zinc-400";
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-zinc-800/50 last:border-0">
      <span className={`mt-0.5 w-2 h-2 shrink-0 rounded-full bg-current ${color}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-300">
          {event.playerHandle && (
            <span className="font-medium text-zinc-100">{event.playerHandle} </span>
          )}
          <span className={color}>{event.label}</span>
          {event.systemName && (
            <span className="text-zinc-500"> · {event.systemName}</span>
          )}
        </p>
      </div>
      <span className="shrink-0 text-xs text-zinc-600">{timeAgo(event.occurredAt)}</span>
    </div>
  );
}

interface FeedClientProps {
  initialEvents: FeedEvent[];
}

export function FeedClient({ initialEvents }: FeedClientProps) {
  const [events, setEvents]       = useState<FeedEvent[]>(initialEvents);
  const [loading, setLoading]     = useState(false);
  const [hasMore, setHasMore]     = useState(initialEvents.length === 50);

  async function loadMore() {
    const oldest = events[events.length - 1];
    if (!oldest) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/game/feed?limit=50&before=${encodeURIComponent(oldest.occurredAt)}`);
      const json = await res.json();
      if (json.ok) {
        const next: FeedEvent[] = json.data.events;
        setEvents((prev) => [...prev, ...next]);
        setHasMore(next.length === 50);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {events.length === 0 && (
        <p className="text-sm text-zinc-600 py-4 text-center">No events yet.</p>
      )}

      <div>
        {events.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50 transition-colors border border-zinc-800 rounded"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
