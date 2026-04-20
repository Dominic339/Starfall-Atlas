/**
 * GET /api/game/feed
 *
 * Returns the global world changes feed: the 50 most recent world events
 * enriched with player handles and system names. Publicly readable (no auth
 * required) so the feed can be embedded on the landing page too.
 *
 * Query params:
 *   limit  — number of events (1–100, default 50)
 *   before — ISO timestamp cursor for pagination
 */

import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import { systemDisplayName } from "@/lib/catalog";

export const dynamic = "force-dynamic";

type RawEvent = {
  id: string;
  event_type: string;
  player_id: string | null;
  system_id: string | null;
  body_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
};

type HandleRow = { id: string; handle: string };

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawLimit  = parseInt(searchParams.get("limit") ?? "50", 10);
  const limit     = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));
  const before    = searchParams.get("before");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  let query = admin
    .from("world_events")
    .select("id, event_type, player_id, system_id, body_id, metadata, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt("occurred_at", before);
  }

  const { data: rawEvents } = listResult<RawEvent>(await query);
  const events = rawEvents ?? [];

  // Enrich with player handles
  const playerIds = [...new Set(events.map((e) => e.player_id).filter(Boolean))] as string[];
  const handleMap = new Map<string, string>();
  if (playerIds.length > 0) {
    const { data: handles } = listResult<HandleRow>(
      await admin.from("players").select("id, handle").in("id", playerIds),
    );
    for (const h of handles ?? []) handleMap.set(h.id, h.handle);
  }

  const enriched = events.map((e) => ({
    id:          e.id,
    eventType:   e.event_type,
    label:       LABEL[e.event_type] ?? e.event_type,
    playerHandle: e.player_id ? (handleMap.get(e.player_id) ?? "Unknown") : null,
    systemId:    e.system_id,
    systemName:  e.system_id ? systemDisplayName(e.system_id) : null,
    metadata:    e.metadata,
    occurredAt:  e.occurred_at,
  }));

  return Response.json({ ok: true, data: { events: enriched } });
}
