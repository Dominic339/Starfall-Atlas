/**
 * POST /api/game/message/read
 *
 * Marks a received message as read. Body: { messageId: string }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const Schema = z.object({ messageId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const raw = await request.json().catch(() => ({}));
  const input = parseInput(Schema, raw);
  if (!input.ok) return toErrorResponse(input.error);
  const { messageId } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: msg } = maybeSingleResult<{ id: string; recipient_id: string; read_at: string | null }>(
    await admin
      .from("player_messages")
      .select("id, recipient_id, read_at")
      .eq("id", messageId)
      .maybeSingle(),
  );
  if (!msg || msg.recipient_id !== player.id) {
    return toErrorResponse(fail("not_found", "Message not found.").error);
  }
  if (msg.read_at) {
    return Response.json({ ok: true, data: { alreadyRead: true } });
  }

  await admin
    .from("player_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("id", messageId);

  return Response.json({ ok: true, data: { marked: true } });
}
