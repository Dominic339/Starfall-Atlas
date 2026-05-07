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

  type MsgRow    = { id: string; sender_id: string; recipient_id: string; subject: string; body: string; sent_at: string; read_at: string | null };
  type AMsgRow   = { id: string; sender_id: string; body: string; sent_at: string };
  type HandleRow = { id: string; handle: string };

  // ── Batch 1: inbox + alliance membership (parallel) ───────────────────────
  const [inboxRes, membershipRes] = await Promise.all([
    admin.from("player_messages").select("id, sender_id, recipient_id, subject, body, sent_at, read_at").eq("recipient_id", player.id).eq("deleted_recipient", false).order("sent_at", { ascending: false }).limit(30),
    admin.from("alliance_members").select("alliance_id").eq("player_id", player.id).maybeSingle(),
  ]);

  const { data: membership } = maybeSingleResult<{ alliance_id: string }>(membershipRes);
  const inboxMessages = listResult<MsgRow>(inboxRes).data ?? [];
  const senderIds = [...new Set(inboxMessages.map((m) => m.sender_id))];

  // ── Batch 2: inbox sender handles + alliance messages (parallel) ───────────
  const [handleRes, aMsgsRes] = await Promise.all([
    senderIds.length > 0
      ? admin.from("players").select("id, handle").in("id", senderIds)
      : Promise.resolve({ data: [] }),
    membership
      ? admin.from("alliance_messages").select("id, sender_id, body, sent_at").eq("alliance_id", membership.alliance_id).order("sent_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
  ]);

  const handleMap = new Map<string, string>();
  for (const h of (listResult<HandleRow>(handleRes).data ?? [])) handleMap.set(h.id, h.handle);

  const inbox: DirectMessage[] = inboxMessages.map((m) => ({
    id:            m.id,
    subject:       m.subject,
    body:          m.body,
    sentAt:        m.sent_at,
    readAt:        m.read_at,
    partnerHandle: handleMap.get(m.sender_id) ?? "Unknown",
    isRead:        !!m.read_at,
  }));

  // ── Alliance messages ─────────────────────────────────────────────────────
  let allianceMessages: AllianceMessage[] | null = null;

  if (membership) {
    const aMsgs = listResult<AMsgRow>(aMsgsRes).data ?? [];
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

      <div className="animate-fade-in-up">
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
