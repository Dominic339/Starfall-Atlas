/**
 * POST /api/game/alliance/message/send
 *
 * Sends a broadcast message to all members of the player's alliance.
 * Body: { body: string }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const Schema = z.object({
  body: z.string().min(1).max(2000),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const raw = await request.json().catch(() => ({}));
  const input = parseInput(Schema, raw);
  if (!input.ok) return toErrorResponse(input.error);
  const { body } = input.data;

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

  const { data: msg } = maybeSingleResult<{ id: string; sent_at: string }>(
    await admin
      .from("alliance_messages")
      .insert({ alliance_id: membership.alliance_id, sender_id: player.id, body })
      .select("id, sent_at")
      .maybeSingle(),
  );

  return Response.json({ ok: true, data: { messageId: msg?.id, sentAt: msg?.sent_at } });
}
