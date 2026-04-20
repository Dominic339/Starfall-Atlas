"use client";

import { useState } from "react";

export interface DirectMessage {
  id: string;
  subject: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  partnerHandle: string;
  isRead: boolean;
}

export interface AllianceMessage {
  id: string;
  body: string;
  sentAt: string;
  senderHandle: string;
  isOwn: boolean;
}

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

function ComposeForm({ onSent }: { onSent: () => void }) {
  const [to, setTo]         = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody]     = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError]   = useState("");
  const [success, setSuccess] = useState(false);

  async function send() {
    if (!to.trim() || !body.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/game/message/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientHandle: to.trim(), subject: subject.trim(), body: body.trim() }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error?.message ?? "Failed to send."); return; }
      setTo(""); setSubject(""); setBody("");
      setSuccess(true);
      onSent();
      setTimeout(() => setSuccess(false), 3000);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3 rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Compose</p>
      <input
        type="text"
        placeholder="To (player handle)"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
      />
      <input
        type="text"
        placeholder="Subject (optional)"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
      />
      <textarea
        rows={4}
        placeholder="Message…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={send}
          disabled={sending || !to.trim() || !body.trim()}
          className="px-4 py-1.5 text-xs font-semibold rounded border border-indigo-700/60 bg-indigo-900/30 text-indigo-300 hover:bg-indigo-800/40 disabled:opacity-50 transition-colors"
        >
          {sending ? "Sending…" : "Send"}
        </button>
        {success && <span className="text-xs text-emerald-400">Sent!</span>}
        {error   && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}

function MessageRow({ msg, onOpen }: { msg: DirectMessage; onOpen: (m: DirectMessage) => void }) {
  return (
    <button
      onClick={() => onOpen(msg)}
      className={`w-full text-left flex items-start gap-3 py-2.5 px-3 rounded border transition-colors ${
        msg.isRead
          ? "border-zinc-800 hover:bg-zinc-800/30"
          : "border-indigo-800/40 bg-indigo-900/10 hover:bg-indigo-900/20"
      }`}
    >
      {!msg.isRead && <span className="mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full bg-indigo-400" />}
      {msg.isRead  && <span className="mt-1.5 w-1.5 h-1.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-200 truncate">
          <span className="font-medium">{msg.partnerHandle}</span>
          {msg.subject ? <span className="ml-2 text-zinc-500">· {msg.subject}</span> : null}
        </p>
        <p className="text-xs text-zinc-600 truncate">{msg.body.slice(0, 80)}</p>
      </div>
      <span className="shrink-0 text-xs text-zinc-600">{timeAgo(msg.sentAt)}</span>
    </button>
  );
}

interface Props {
  inbox: DirectMessage[];
  allianceMessages: AllianceMessage[] | null;
  inAlliance: boolean;
}

export function MessagesClient({ inbox: initialInbox, allianceMessages: initialAlliance, inAlliance }: Props) {
  const [tab, setTab]           = useState<"inbox" | "alliance">("inbox");
  const [inbox, setInbox]       = useState(initialInbox);
  const [allianceChat, setAllianceChat] = useState(initialAlliance ?? []);
  const [open, setOpen]         = useState<DirectMessage | null>(null);
  const [allianceBody, setAllianceBody] = useState("");
  const [allianceSending, setAllianceSending] = useState(false);

  async function refreshInbox() {
    const res = await fetch("/api/game/message/inbox");
    const json = await res.json();
    if (json.ok) setInbox(json.data.messages);
  }

  async function markRead(msg: DirectMessage) {
    setOpen(msg);
    if (!msg.isRead) {
      await fetch("/api/game/message/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: msg.id }),
      });
      setInbox((prev) => prev.map((m) => m.id === msg.id ? { ...m, isRead: true } : m));
    }
  }

  async function sendAlliance() {
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
    } finally {
      setAllianceSending(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800">
        {(["inbox", "alliance"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-semibold uppercase tracking-widest transition-colors ${
              tab === t
                ? "border-b-2 border-indigo-500 text-indigo-300 -mb-px"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "inbox" ? "Inbox" : "Alliance Chat"}
          </button>
        ))}
      </div>

      {tab === "inbox" && (
        <div className="space-y-4">
          <ComposeForm onSent={refreshInbox} />

          {open && (
            <div className="rounded border border-zinc-700 bg-zinc-900 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-200">
                  {open.subject || "(No subject)"}
                </p>
                <button onClick={() => setOpen(null)} className="text-xs text-zinc-500 hover:text-zinc-300">✕ Close</button>
              </div>
              <p className="text-xs text-zinc-500">From {open.partnerHandle} · {timeAgo(open.sentAt)}</p>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">{open.body}</p>
            </div>
          )}

          <div className="space-y-1">
            {inbox.length === 0 && (
              <p className="py-4 text-center text-sm text-zinc-600">No messages.</p>
            )}
            {inbox.map((m) => (
              <MessageRow key={m.id} msg={m} onOpen={markRead} />
            ))}
          </div>
        </div>
      )}

      {tab === "alliance" && (
        <div className="space-y-3">
          {!inAlliance && (
            <p className="text-sm text-zinc-500">You are not in an alliance.</p>
          )}
          {inAlliance && (
            <>
              <div className="space-y-2 max-h-80 overflow-y-auto flex flex-col-reverse">
                {allianceChat.length === 0 && (
                  <p className="py-4 text-center text-sm text-zinc-600">No alliance messages yet.</p>
                )}
                {[...allianceChat].reverse().map((m) => (
                  <div
                    key={m.id}
                    className={`rounded px-3 py-2 text-sm ${
                      m.isOwn
                        ? "bg-indigo-900/20 border border-indigo-800/30 self-end ml-8"
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
                  rows={2}
                  placeholder="Message alliance…"
                  value={allianceBody}
                  onChange={(e) => setAllianceBody(e.target.value)}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
                />
                <button
                  onClick={sendAlliance}
                  disabled={allianceSending || !allianceBody.trim()}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-violet-700/60 bg-violet-900/30 text-violet-300 hover:bg-violet-800/40 disabled:opacity-50 transition-colors"
                >
                  {allianceSending ? "…" : "Send"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
