"use client";

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DirectMessage {
  id: string;
  subject: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  partnerHandle: string;
  isRead: boolean;
}

interface AllianceMessage {
  id: string;
  body: string;
  sentAt: string;
  senderHandle: string;
  isOwn: boolean;
}

interface MessagesMapPanelProps { onClose: () => void; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MessagesMapPanel({ onClose }: MessagesMapPanelProps) {
  const [tab, setTab] = useState<"inbox" | "alliance">("inbox");

  // Inbox state
  const [inbox, setInbox] = useState<DirectMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [openMsg, setOpenMsg] = useState<DirectMessage | null>(null);

  // Compose state
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Alliance chat state
  const [allianceChat, setAllianceChat] = useState<AllianceMessage[]>([]);
  const [inAlliance, setInAlliance] = useState<boolean | null>(null); // null = loading
  const [allianceBody, setAllianceBody] = useState("");
  const [allianceSending, setAllianceSending] = useState(false);

  // Load inbox on mount
  useEffect(() => {
    setInboxLoading(true);
    fetch("/api/game/message/inbox")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setInbox(json.data.messages); })
      .catch(() => {})
      .finally(() => setInboxLoading(false));
  }, []);

  // Load alliance messages when tab switches
  useEffect(() => {
    if (tab !== "alliance" || inAlliance !== null) return;
    fetch("/api/game/alliance/message/list")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) { setAllianceChat(json.data.messages); setInAlliance(true); }
        else setInAlliance(false);
      })
      .catch(() => setInAlliance(false));
  }, [tab, inAlliance]);

  async function refreshInbox() {
    const res = await fetch("/api/game/message/inbox");
    const json = await res.json();
    if (json.ok) setInbox(json.data.messages);
  }

  async function handleSend() {
    if (!composeTo.trim() || !composeBody.trim()) return;
    setSendLoading(true); setSendError(null);
    try {
      const res = await fetch("/api/game/message/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientHandle: composeTo.trim(), subject: composeSubject.trim(), body: composeBody.trim() }),
      });
      const json = await res.json();
      if (!json.ok) { setSendError(json.error?.message ?? "Failed to send."); return; }
      setComposeTo(""); setComposeSubject(""); setComposeBody("");
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 3000);
      refreshInbox();
    } catch { setSendError("Network error."); }
    finally { setSendLoading(false); }
  }

  async function handleOpenMsg(msg: DirectMessage) {
    setOpenMsg(msg);
    if (!msg.isRead) {
      await fetch("/api/game/message/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: msg.id }),
      });
      setInbox((prev) => prev.map((m) => m.id === msg.id ? { ...m, isRead: true, readAt: new Date().toISOString() } : m));
    }
  }

  async function handleAllianceSend() {
    if (!allianceBody.trim()) return;
    setAllianceSending(true);
    try {
      const res = await fetch("/api/game/alliance/message/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: allianceBody.trim() }),
      });
      const json = await res.json();
      if (json.ok) {
        setAllianceBody("");
        const r2 = await fetch("/api/game/alliance/message/list");
        const j2 = await r2.json();
        if (j2.ok) setAllianceChat(j2.data.messages);
      }
    } finally { setAllianceSending(false); }
  }

  const unreadCount = inbox.filter((m) => !m.isRead).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      <div className="relative w-full max-w-xl max-h-[88vh] flex flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-zinc-200">Messages</h2>
            {unreadCount > 0 && (
              <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                {unreadCount}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-zinc-800 px-4 pt-2 shrink-0">
          {(["inbox", "alliance"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-xs rounded-t transition-colors ${
                tab === t ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {t === "inbox" ? `Inbox${unreadCount > 0 ? ` (${unreadCount})` : ""}` : "Alliance Chat"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* ── Inbox tab ─────────────────────────────────────────────────── */}
          {tab === "inbox" && (
            <>
              {/* Compose form */}
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Compose</p>
                <input
                  type="text" placeholder="To (player handle)"
                  value={composeTo} onChange={(e) => setComposeTo(e.target.value)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <input
                  type="text" placeholder="Subject (optional)"
                  value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <textarea
                  rows={3} placeholder="Message…"
                  value={composeBody} onChange={(e) => setComposeBody(e.target.value)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSend}
                    disabled={sendLoading || !composeTo.trim() || !composeBody.trim()}
                    className="px-4 py-1.5 text-xs font-semibold rounded border border-indigo-700/60 bg-indigo-900/30 text-indigo-300 hover:bg-indigo-800/40 disabled:opacity-50 transition-colors"
                  >
                    {sendLoading ? "Sending…" : "Send"}
                  </button>
                  {sendSuccess && <span className="text-xs text-emerald-400">Sent!</span>}
                  {sendError && <span className="text-xs text-red-400">{sendError}</span>}
                </div>
              </div>

              {/* Open message view */}
              {openMsg && (
                <div className="rounded border border-zinc-700 bg-zinc-900 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-zinc-200">{openMsg.subject || "(No subject)"}</p>
                    <button onClick={() => setOpenMsg(null)} className="text-xs text-zinc-500 hover:text-zinc-300">✕ Close</button>
                  </div>
                  <p className="text-xs text-zinc-500">From {openMsg.partnerHandle} · {timeAgo(openMsg.sentAt)}</p>
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">{openMsg.body}</p>
                </div>
              )}

              {/* Inbox list */}
              {inboxLoading && <p className="text-xs text-zinc-600 text-center py-4">Loading…</p>}
              {!inboxLoading && inbox.length === 0 && (
                <p className="text-sm text-zinc-600 text-center py-4">No messages.</p>
              )}
              <div className="space-y-1">
                {inbox.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleOpenMsg(m)}
                    className={`w-full text-left flex items-start gap-3 py-2.5 px-3 rounded border transition-colors ${
                      m.isRead
                        ? "border-zinc-800 hover:bg-zinc-800/30"
                        : "border-indigo-800/40 bg-indigo-900/10 hover:bg-indigo-900/20"
                    }`}
                  >
                    <span className={`mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full ${m.isRead ? "bg-transparent" : "bg-indigo-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">
                        <span className="font-medium">{m.partnerHandle}</span>
                        {m.subject && <span className="ml-2 text-zinc-500">· {m.subject}</span>}
                      </p>
                      <p className="text-xs text-zinc-600 truncate">{m.body.slice(0, 80)}</p>
                    </div>
                    <span className="shrink-0 text-xs text-zinc-600">{timeAgo(m.sentAt)}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Alliance chat tab ──────────────────────────────────────────── */}
          {tab === "alliance" && (
            <div className="space-y-3">
              {inAlliance === null && <p className="text-xs text-zinc-600 text-center py-4">Loading…</p>}
              {inAlliance === false && (
                <p className="text-sm text-zinc-500 text-center py-4">You are not in an alliance.</p>
              )}
              {inAlliance === true && (
                <>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {allianceChat.length === 0 && (
                      <p className="text-sm text-zinc-600 text-center py-4">No messages yet.</p>
                    )}
                    {allianceChat.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded px-3 py-2 text-sm ${
                          m.isOwn
                            ? "bg-indigo-900/20 border border-indigo-800/30 ml-8"
                            : "bg-zinc-800/30 border border-zinc-700/30 mr-8"
                        }`}
                      >
                        {!m.isOwn && (
                          <p className="text-xs font-semibold text-violet-400 mb-1">{m.senderHandle}</p>
                        )}
                        <p className="text-zinc-200 whitespace-pre-wrap">{m.body}</p>
                        <p className="text-xs text-zinc-600 mt-1">{timeAgo(m.sentAt)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <textarea
                      rows={2} placeholder="Message alliance…"
                      value={allianceBody} onChange={(e) => setAllianceBody(e.target.value)}
                      className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
                    />
                    <button
                      onClick={handleAllianceSend}
                      disabled={allianceSending || !allianceBody.trim()}
                      className="px-3 py-1.5 text-xs font-semibold rounded border border-violet-700/60 bg-violet-900/30 text-violet-300 hover:bg-violet-800/40 disabled:opacity-50 transition-colors self-end"
                    >
                      {allianceSending ? "…" : "Send"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
