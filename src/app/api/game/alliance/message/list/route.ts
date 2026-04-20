/**
 * GET /api/game/alliance/message/list
 *
 * Returns the 50 most recent messages in the player's alliance chat.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: membership } = maybeSingleResult<{ alliance_id: string }>(
    await admin
      .from("alliance_members")
      .select("alliance_id")
      .eq("player_id", player.id)
      .maybeSingle(),
  );
  if (!membership) {
    return toErrorResponse(fail("forbidden", "You are not in an alliance.").error);
  }

  type MsgRow = { id: string; sender_id: string; body: string; sent_at: string };
  type HandleRow = { id: string; handle: string };

  const { data: msgs } = listResult<MsgRow>(
    await admin
      .from("alliance_messages")
      .select("id, sender_id, body, sent_at")
      .eq("alliance_id", membership.alliance_id)
      .order("sent_at", { ascending: false })
      .limit(50),
  );

  const messages = msgs ?? [];
  const senderIds = [...new Set(messages.map((m) => m.sender_id))];
  const handleMap = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: handles } = listResult<HandleRow>(
      await admin.from("players").select("id, handle").in("id", senderIds),
    );
    for (const h of handles ?? []) handleMap.set(h.id, h.handle);
  }

  const enriched = messages
    .slice()
    .reverse()
    .map((m) => ({
      id:            m.id,
      body:          m.body,
      sentAt:        m.sent_at,
      senderHandle:  handleMap.get(m.sender_id) ?? "Unknown",
      isOwn:         m.sender_id === player.id,
    }));

  return Response.json({ ok: true, data: { messages: enriched } });
}
