/**
 * /game/feed — World Changes Feed (Phase 15)
 *
 * Server component. Fetches the 50 most recent world events and renders
 * a paginated feed. Client handles "load more" pagination.
 */

import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import { systemDisplayName } from "@/lib/catalog";
import { FeedClient, type FeedEvent } from "./_components/FeedClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "World Feed — Starfall Atlas" };

const LABEL: Record<string, string> = {
  system_discovered:    "System discovered",
  colony_founded:       "Colony founded",
  colony_sold:          "Colony sold",
  colony_abandoned:     "Colony abandoned",
  colony_collapsed:     "Colony collapsed",
  colony_reactivated:   "Colony reactivated",
  system_sold:          "System sold",
  alliance_formed:      "Alliance formed",
  alliance_dissolved:   "Alliance dissolved",
  lane_built:           "Hyperspace lane built",
  gate_built:           "Hyperspace gate built",
  gate_neutralized:     "Gate neutralized",
  gate_reclaimed:       "Gate reclaimed",
  stewardship_registered:  "Stewardship registered",
  stewardship_transferred: "Stewardship transferred",
  majority_control_gained: "Majority control gained",
  majority_control_lost:   "Majority control lost",
};

export default async function FeedPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  type RawEvent = {
    id: string;
    event_type: string;
    player_id: string | null;
    system_id: string | null;
    metadata: Record<string, unknown>;
    occurred_at: string;
  };
  type HandleRow = { id: string; handle: string };

  const { data: rawEvents } = listResult<RawEvent>(
    await admin
      .from("world_events")
      .select("id, event_type, player_id, system_id, metadata, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(50),
  );
  const events = rawEvents ?? [];

  const playerIds = [...new Set(events.map((e) => e.player_id).filter(Boolean))] as string[];
  const handleMap = new Map<string, string>();
  if (playerIds.length > 0) {
    const { data: handles } = listResult<HandleRow>(
      await admin.from("players").select("id, handle").in("id", playerIds),
    );
    for (const h of handles ?? []) handleMap.set(h.id, h.handle);
  }

  const initialEvents: FeedEvent[] = events.map((e) => ({
    id:           e.id,
    eventType:    e.event_type,
    label:        LABEL[e.event_type] ?? e.event_type,
    playerHandle: e.player_id ? (handleMap.get(e.player_id) ?? "Unknown") : null,
    systemId:     e.system_id,
    systemName:   e.system_id ? systemDisplayName(e.system_id) : null,
    metadata:     e.metadata ?? {},
    occurredAt:   e.occurred_at,
  }));

  return (
    <div className="max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link
          href="/game/command"
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          ← Command
        </Link>
        <span className="text-zinc-800 text-xs">/</span>
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          World Feed
        </span>
      </div>

      <div>
        <h1 className="text-lg font-bold tracking-tight text-zinc-100">World Changes</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Major events across the galaxy — discoveries, colony events, governance changes,
          lane construction, and more.
        </p>
      </div>

      <FeedClient initialEvents={initialEvents} />
    </div>
  );
}
