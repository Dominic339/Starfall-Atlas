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
  system_discovered:       "System discovered",
  colony_founded:          "Colony founded",
  colony_sold:             "Colony sold",
  colony_abandoned:        "Colony abandoned",
  colony_collapsed:        "Colony collapsed",
  colony_reactivated:      "Colony reactivated",
  system_sold:             "System sold",
  alliance_formed:         "Alliance formed",
  alliance_dissolved:      "Alliance dissolved",
  lane_built:              "Hyperspace lane built",
  gate_built:              "Hyperspace gate built",
  gate_neutralized:        "Gate neutralized",
  gate_reclaimed:          "Gate reclaimed",
  stewardship_registered:  "Stewardship registered",
  stewardship_transferred: "Stewardship transferred",
  majority_control_gained: "Majority control gained",
  majority_control_lost:   "Majority control lost",
  auction_started:         "Auction started",
  auction_resolved:        "Auction resolved",
  dispute_opened:          "Alliance dispute opened",
  dispute_resolved:        "Alliance dispute resolved",
  dispute_expired:         "Alliance dispute expired",
};

function buildSummary(
  eventType: string,
  handle: string | null,
  systemId: string | null,
  metadata: Record<string, unknown>,
): string {
  const sys = systemId ? systemDisplayName(systemId) : null;
  const who = handle ?? "Someone";
  const m = metadata;
  switch (eventType) {
    case "system_discovered":   return `${who} discovered ${sys ?? "a new system"}`;
    case "colony_founded":      return `${who} founded a colony in ${sys ?? "an unknown system"}`;
    case "colony_abandoned":    return `${who}'s colony in ${sys ?? "an unknown system"} was abandoned`;
    case "colony_collapsed":    return `${who}'s colony in ${sys ?? "an unknown system"} collapsed`;
    case "colony_reactivated":  return `${who} reactivated a colony in ${sys ?? "an unknown system"}`;
    case "gate_built":          return `${who} constructed a hyperspace gate in ${sys ?? "an unknown system"}`;
    case "gate_neutralized":    return `A gate in ${sys ?? "an unknown system"} was neutralized`;
    case "gate_reclaimed":      return `${who} reclaimed a gate in ${sys ?? "an unknown system"}`;
    case "lane_built": {
      const toSys = m.to_system_id ? systemDisplayName(m.to_system_id as string) : "an unknown system";
      return `${who} completed a hyperspace lane to ${toSys}`;
    }
    case "alliance_formed":     return `${who} founded alliance [${m.tag ?? "?"}] ${m.name ?? ""}`.trim();
    case "dispute_opened": {
      const atk = m.attacking_alliance_tag ?? "?";
      const def = m.defending_alliance_tag ?? "?";
      return `[${atk}] opened a beacon dispute against [${def}] in ${sys ?? "an unknown system"}`;
    }
    case "dispute_resolved": {
      const winner = m.winner_tag ?? "?";
      const atk = m.attacking_alliance_tag ?? "?";
      const def = m.defending_alliance_tag ?? "?";
      const atkScore = m.attacker_score as number ?? 0;
      const defScore = m.defender_score as number ?? 0;
      return `[${winner}] won the dispute in ${sys ?? "an unknown system"} — ${atk} ${atkScore} vs ${def} ${defScore}`;
    }
    case "dispute_expired":
      return `A beacon dispute in ${sys ?? "an unknown system"} expired with no reinforcements`;
    case "auction_started":
      return `${who} opened an auction (${m.item_type ?? "item"}) starting at ${m.min_bid ?? 0} ¢`;
    case "auction_resolved": {
      const price = (m.price as number | undefined) ?? (m.winning_bid as number | undefined);
      return price ? `An auction resolved — ${m.item_type ?? "item"} sold for ${price.toLocaleString()} ¢` : "An auction ended without a winner";
    }
    case "majority_control_gained":
      return `${who} gained majority control of ${sys ?? "a system"}`;
    case "majority_control_lost":
      return `${who} lost majority control of ${sys ?? "a system"}`;
    case "stewardship_registered":
      return `${who} registered stewardship over ${sys ?? "a system"}`;
    default:
      return LABEL[eventType] ?? eventType;
  }
}

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

  const initialEvents: FeedEvent[] = events.map((e) => {
    const handle = e.player_id ? (handleMap.get(e.player_id) ?? "Unknown") : null;
    const meta = e.metadata ?? {};
    return {
      id:           e.id,
      eventType:    e.event_type,
      label:        LABEL[e.event_type] ?? e.event_type,
      summary:      buildSummary(e.event_type, handle, e.system_id, meta),
      playerHandle: handle,
      systemId:     e.system_id,
      systemName:   e.system_id ? systemDisplayName(e.system_id) : null,
      metadata:     meta,
      occurredAt:   e.occurred_at,
    };
  });

  return (
    <div className="max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 animate-fade-in-up">
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

      <div className="animate-fade-in-up">
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
