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

const EVENT_ICON_BG: Record<string, string> = {
  system_discovered:       "bg-indigo-950/60 ring-indigo-800/40",
  colony_founded:          "bg-emerald-950/60 ring-emerald-800/40",
  colony_abandoned:        "bg-amber-950/60 ring-amber-800/40",
  colony_collapsed:        "bg-red-950/60 ring-red-800/40",
  colony_reactivated:      "bg-emerald-950/60 ring-emerald-700/40",
  colony_sold:             "bg-orange-950/60 ring-orange-800/40",
  system_sold:             "bg-orange-950/60 ring-orange-800/40",
  alliance_formed:         "bg-violet-950/60 ring-violet-800/40",
  alliance_dissolved:      "bg-zinc-800/60 ring-zinc-700/40",
  lane_built:              "bg-sky-950/60 ring-sky-800/40",
  gate_built:              "bg-sky-950/60 ring-sky-700/40",
  gate_neutralized:        "bg-amber-950/60 ring-amber-700/40",
  gate_reclaimed:          "bg-emerald-950/60 ring-emerald-700/40",
  stewardship_registered:  "bg-teal-950/60 ring-teal-800/40",
  stewardship_transferred: "bg-teal-950/60 ring-teal-700/40",
  majority_control_gained: "bg-rose-950/60 ring-rose-800/40",
  majority_control_lost:   "bg-rose-950/60 ring-rose-700/40",
};

function EventIcon({ eventType, colorClass }: { eventType: string; colorClass: string }) {
  const bg = EVENT_ICON_BG[eventType] ?? "bg-zinc-800/60 ring-zinc-700/40";
  return (
    <span className={`mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center ring-1 ${bg}`}>
      <svg className={`w-3 h-3 ${colorClass}`} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        {getIconPath(eventType)}
      </svg>
    </span>
  );
}

function getIconPath(eventType: string) {
  switch (eventType) {
    case "system_discovered":
      // Telescope / eye
      return <path d="M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zm0 1.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />;
    case "colony_founded":
      // Flag
      return <path d="M3 2v12h1.5V9.5H11l-2-3 2-3H4.5V2H3zm1.5 2H9.2L7.7 6.5 9.2 9H4.5V4z" />;
    case "colony_abandoned":
      // Warning triangle
      return <path d="M8 1.5L1 13.5h14L8 1.5zm0 2.3 5.5 9.2H2.5L8 3.8zM7.25 7v3h1.5V7h-1.5zm0 4v1.5h1.5V11h-1.5z" />;
    case "colony_collapsed":
      // X / collapse
      return <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />;
    case "colony_reactivated":
      // Refresh arrow
      return <path d="M8 3a5 5 0 0 0-4.9 4H1.5L4 9.5 6.5 7H5.1A2.9 2.9 0 1 1 8 11v1.5A4.5 4.5 0 1 0 8 3z" />;
    case "colony_sold":
    case "system_sold":
      // Tag / sale
      return <path d="M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5V2zm3 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />;
    case "alliance_formed":
      // Handshake / two circles linked
      return <path d="M5 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm6 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 14c0-2.2 1.8-4 4-4h.5a4.5 4.5 0 0 0 3 0H10c2.2 0 4 1.8 4 4H2z" />;
    case "alliance_dissolved":
      // Break / chain broken
      return <path d="M6 4H4a2 2 0 0 0 0 4h2M10 4h2a2 2 0 0 0 0 4h-2M6 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />;
    case "lane_built":
      // Arrows / route
      return <path d="M2 8h12M10 5l4 3-4 3M6 5L2 8l4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />;
    case "gate_built":
      // Portal / gateway arch
      return <path d="M3 13V7a5 5 0 0 1 10 0v6M6 13V7a2 2 0 0 1 4 0v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />;
    case "gate_neutralized":
      // Lock open / neutralized
      return <path d="M5 7V5a3 3 0 0 1 5.8-1M5 7h6a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm3 2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />;
    case "gate_reclaimed":
      // Shield check
      return <path d="M8 2L3 4v4c0 3 2.3 5.3 5 6 2.7-.7 5-3 5-6V4L8 2zm-1 6.5l-1.5-1.5-1 1L7 11l4-4-1-1L7 8.5z" />;
    case "stewardship_registered":
      // Star / crown
      return <path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5L8 2z" />;
    case "stewardship_transferred":
      // Arrow right with star
      return <path d="M3 8h8M8 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />;
    case "majority_control_gained":
      // Rising chart / up arrow
      return <path d="M2 12l4-4 3 2 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />;
    case "majority_control_lost":
      // Falling chart / down arrow
      return <path d="M2 4l4 4 3-2 5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />;
    default:
      return <circle cx="8" cy="8" r="3" />;
  }
}

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
    <div className="flex items-start gap-3 py-2.5 border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/20 transition-colors rounded px-1 -mx-1">
      <EventIcon eventType={event.eventType} colorClass={color} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-300 leading-snug">
          {event.playerHandle && (
            <span className="font-semibold text-zinc-100">{event.playerHandle} </span>
          )}
          <span className={color}>{event.label}</span>
        </p>
        {event.systemName && (
          <p className="text-xs text-zinc-600 mt-0.5">{event.systemName}</p>
        )}
      </div>
      <span className="shrink-0 text-xs text-zinc-600 tabular-nums mt-0.5">{timeAgo(event.occurredAt)}</span>
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
        <div className="flex flex-col items-center gap-2 py-10 text-center border border-dashed border-zinc-800 rounded-lg">
          <svg className="w-8 h-8 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z" />
          </svg>
          <p className="text-sm text-zinc-600">No events yet</p>
          <p className="text-xs text-zinc-700">Activity will appear here as the galaxy comes to life.</p>
        </div>
      )}

      <div className="stagger-children">
        {events.map((e) => (
          <div key={e.id} className="animate-fade-in-up">
            <EventRow event={e} />
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50 transition-colors border border-zinc-800 rounded hover:border-zinc-700 btn-glow"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
