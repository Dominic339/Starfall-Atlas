/**
 * /game/messages — In-game messaging (Phase 15)
 *
 * Server component. Fetches inbox + alliance messages for initial render.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import type { Player } from "@/lib/types/game";
import {
  MessagesClient,
  type DirectMessage,
  type AllianceMessage,
} from "./_components/MessagesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — Starfall Atlas" };

export default async function MessagesPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("id, handle").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // ── Fetch inbox ────────────────────────────────────────────────────────────
  type MsgRow = {
    id: string; sender_id: string; recipient_id: string;
    subject: string; body: string; sent_at: string; read_at: string | null;
  };
  type HandleRow = { id: string; handle: string };

  const { data: rawInbox } = listResult<MsgRow>(
    await admin
      .from("player_messages")
      .select("id, sender_id, recipient_id, subject, body, sent_at, read_at")
      .eq("recipient_id", player.id)
      .eq("deleted_recipient", false)
      .order("sent_at", { ascending: false })
      .limit(30),
  );

  const inboxMessages = rawInbox ?? [];
  const senderIds = [...new Set(inboxMessages.map((m) => m.sender_id))];
  const handleMap = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: handles } = listResult<HandleRow>(
      await admin.from("players").select("id, handle").in("id", senderIds),
    );
    for (const h of handles ?? []) handleMap.set(h.id, h.handle);
  }

  const inbox: DirectMessage[] = inboxMessages.map((m) => ({
    id:            m.id,
    subject:       m.subject,
    body:          m.body,
    sentAt:        m.sent_at,
    readAt:        m.read_at,
    partnerHandle: handleMap.get(m.sender_id) ?? "Unknown",
    isRead:        !!m.read_at,
  }));

  // ── Alliance membership + messages ────────────────────────────────────────
  const { data: membership } = maybeSingleResult<{ alliance_id: string }>(
    await admin
      .from("alliance_members")
      .select("alliance_id")
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  let allianceMessages: AllianceMessage[] | null = null;

  if (membership) {
    type AMsgRow = { id: string; sender_id: string; body: string; sent_at: string };
    const { data: rawAMsgs } = listResult<AMsgRow>(
      await admin
        .from("alliance_messages")
        .select("id, sender_id, body, sent_at")
        .eq("alliance_id", membership.alliance_id)
        .order("sent_at", { ascending: false })
        .limit(50),
    );

    const aMsgs = rawAMsgs ?? [];
    const aSenderIds = [...new Set(aMsgs.map((m) => m.sender_id))];
    const aHandleMap = new Map<string, string>();
    if (aSenderIds.length > 0) {
      const { data: aHandles } = listResult<HandleRow>(
        await admin.from("players").select("id, handle").in("id", aSenderIds),
      );
      for (const h of aHandles ?? []) aHandleMap.set(h.id, h.handle);
    }

    allianceMessages = aMsgs
      .slice()
      .reverse()
      .map((m) => ({
        id:           m.id,
        body:         m.body,
        sentAt:       m.sent_at,
        senderHandle: aHandleMap.get(m.sender_id) ?? "Unknown",
        isOwn:        m.sender_id === player.id,
      }));
  }

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
          Messages
        </span>
      </div>

      <div>
        <h1 className="text-lg font-bold tracking-tight text-zinc-100">Messages</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Direct messages between players and alliance chat.
        </p>
      </div>

      <MessagesClient
        inbox={inbox}
        allianceMessages={allianceMessages}
        inAlliance={!!membership}
      />
    </div>
  );
}
