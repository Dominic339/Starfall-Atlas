/**
 * GET /api/game/message/inbox
 *
 * Returns the authenticated player's 30 most recent received messages.
 * Query params: sent=1 to get sent messages instead.
 */

import { type NextRequest } from "next/server";
import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const { searchParams } = new URL(request.url);
  const showSent = searchParams.get("sent") === "1";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  type MsgRow = {
    id: string; sender_id: string; recipient_id: string;
    subject: string; body: string; sent_at: string; read_at: string | null;
  };
  type HandleRow = { id: string; handle: string };

  const query = admin
    .from("player_messages")
    .select("id, sender_id, recipient_id, subject, body, sent_at, read_at")
    .order("sent_at", { ascending: false })
    .limit(30);

  const { data: msgs } = listResult<MsgRow>(
    showSent
      ? await query.eq("sender_id", player.id).eq("deleted_sender", false)
      : await query.eq("recipient_id", player.id).eq("deleted_recipient", false),
  );

  const messages = msgs ?? [];
  const partnerIds = [...new Set(messages.map((m) =>
    showSent ? m.recipient_id : m.sender_id,
  ))];
  const handleMap = new Map<string, string>();
  if (partnerIds.length > 0) {
    const { data: handles } = listResult<HandleRow>(
      await admin.from("players").select("id, handle").in("id", partnerIds),
    );
    for (const h of handles ?? []) handleMap.set(h.id, h.handle);
  }

  const enriched = messages.map((m) => ({
    id:              m.id,
    subject:         m.subject,
    bodyPreview:     m.body.slice(0, 120),
    body:            m.body,
    sentAt:          m.sent_at,
    readAt:          m.read_at,
    partnerHandle:   handleMap.get(showSent ? m.recipient_id : m.sender_id) ?? "Unknown",
    isRead:          !!m.read_at,
  }));

  return Response.json({ ok: true, data: { messages: enriched } });
}
