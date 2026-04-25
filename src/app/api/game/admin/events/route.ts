/**
 * GET    /api/game/admin/events  — list all live events
 * POST   /api/game/admin/events  — create or update an event
 * DELETE /api/game/admin/events  — delete an event
 *
 * is_dev only.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import { fail } from "@/lib/actions/types";

export const dynamic = "force-dynamic";

async function requireDev() {
  const auth = await requireAuth();
  if (!auth.ok) return auth;
  if (!auth.data.player.is_dev) return fail("forbidden", "Dev access required");
  return auth;
}

export async function GET() {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: events } = listResult<Record<string, unknown>>(
    await admin.from("live_events").select("*").order("starts_at", { ascending: false }),
  );
  const { data: nodes } = listResult<{ id: string; event_id: string; resource_type: string; remaining_amount: number; status: string }>(
    await admin.from("live_event_nodes").select("id, event_id, resource_type, remaining_amount, status"),
  );

  const nodesByEvent = new Map<string, typeof nodes>();
  for (const n of nodes ?? []) {
    const list = nodesByEvent.get(n.event_id) ?? [];
    list.push(n);
    nodesByEvent.set(n.event_id, list);
  }

  const enriched = (events ?? []).map((e) => ({
    ...e,
    nodes: nodesByEvent.get(e.id as string) ?? [],
  }));

  return Response.json({ ok: true, data: enriched });
}

export async function POST(req: Request) {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const body = await req.json().catch(() => ({}));
  const { nodes: nodesDef, ...eventData } = body as {
    nodes?: { system_id: string; resource_type: string; total_amount: number; display_offset_x?: number; display_offset_y?: number; expires_at?: string }[];
    [k: string]: unknown;
  };

  const isNew = !eventData.id;
  if (isNew) delete eventData.id;

  const { data: savedEvent } = await admin
    .from("live_events")
    .upsert({ ...eventData, created_by: player.id, updated_at: new Date().toISOString() }, { onConflict: isNew ? undefined : "id" })
    .select("id")
    .single();

  const eventId = (savedEvent as { id?: string })?.id ?? eventData.id;

  // If event type is special_asteroid or resource_node, optionally spawn nodes
  if (nodesDef && nodesDef.length > 0 && eventId) {
    await admin.from("live_event_nodes").insert(
      nodesDef.map((n) => ({
        event_id: eventId,
        system_id: n.system_id,
        display_offset_x: n.display_offset_x ?? (Math.random() * 40 - 20),
        display_offset_y: n.display_offset_y ?? (Math.random() * 40 - 20),
        resource_type: n.resource_type,
        total_amount: n.total_amount,
        remaining_amount: n.total_amount,
        expires_at: n.expires_at ?? eventData.ends_at,
      })),
    );
  }

  return Response.json({ ok: true, data: { eventId, message: "Event saved" } });
}

export async function DELETE(req: Request) {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  await admin.from("live_events").delete().eq("id", id);
  return Response.json({ ok: true, data: { message: "Event deleted" } });
}
