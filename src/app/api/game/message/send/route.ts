/**
 * POST /api/game/message/send
 *
 * Sends a direct message from the authenticated player to another player.
 * Body: { recipientHandle: string, subject?: string, body: string }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const Schema = z.object({
  recipientHandle: z.string().min(1).max(32),
  subject:         z.string().max(80).optional().default(""),
  body:            z.string().min(1).max(2000),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const raw = await request.json().catch(() => ({}));
  const input = parseInput(Schema, raw);
  if (!input.ok) return toErrorResponse(input.error);
  const { recipientHandle, subject, body } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: recipient } = maybeSingleResult<{ id: string }>(
    await admin.from("players").select("id").eq("handle", recipientHandle).maybeSingle(),
  );
  if (!recipient) {
    return toErrorResponse(fail("not_found", `Player '${recipientHandle}' not found.`).error);
  }
  if (recipient.id === player.id) {
    return toErrorResponse(fail("validation_error", "Cannot send a message to yourself.").error);
  }

  const { data: msg } = maybeSingleResult<{ id: string; sent_at: string }>(
    await admin
      .from("player_messages")
      .insert({ sender_id: player.id, recipient_id: recipient.id, subject, body })
      .select("id, sent_at")
      .maybeSingle(),
  );

  return Response.json({ ok: true, data: { messageId: msg?.id, sentAt: msg?.sent_at } });
}
