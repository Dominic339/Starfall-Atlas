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

interface AllianceMember {
  id: string; playerId: string; handle: string;
  role: string; allianceCredits: number; isSelf: boolean;
}
interface AllianceGoal {
  id: string; title: string; resource: string;
  target: number; filled: number; creditReward: number;
  deadlineAt: string; pct: number;
}
interface AllianceStorageItem { resource: string; quantity: number; }
interface AlliancePanelData {
  inAlliance: boolean;
  myRole?: string;
  myAllianceCredits?: number;
  alliance?: { id: string; name: string; tag: string; inviteCode: string; memberCount: number };
  members?: AllianceMember[];
  storage?: AllianceStorageItem[];
  goals?: AllianceGoal[];
  stationInventory?: AllianceStorageItem[];
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
  const [tab, setTab] = useState<"inbox" | "chat" | "alliance">("inbox");

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
  const [chatInAlliance, setChatInAlliance] = useState<boolean | null>(null);
  const [allianceBody, setAllianceBody] = useState("");
  const [allianceSending, setAllianceSending] = useState(false);

  // Alliance HQ panel state
  const [allianceData, setAllianceData] = useState<AlliancePanelData | null>(null);
  const [allianceLoading, setAllianceLoading] = useState(false);
  const [allianceLoaded, setAllianceLoaded] = useState(false);
  const [depositResource, setDepositResource] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMsg, setDepositMsg] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [createName, setCreateName] = useState("");
  const [createTag, setCreateTag] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Load inbox on mount
  useEffect(() => {
    setInboxLoading(true);
    fetch("/api/game/message/inbox")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setInbox(json.data.messages); })
      .catch(() => {})
      .finally(() => setInboxLoading(false));
  }, []);

  // Lazy-load alliance chat
  useEffect(() => {
    if (tab !== "chat" || chatInAlliance !== null) return;
    fetch("/api/game/alliance/message/list")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) { setAllianceChat(json.data.messages); setChatInAlliance(true); }
        else setChatInAlliance(false);
      })
      .catch(() => setChatInAlliance(false));
  }, [tab, chatInAlliance]);

  // Lazy-load alliance HQ panel
  useEffect(() => {
    if (tab !== "alliance" || allianceLoaded) return;
    setAllianceLoading(true);
    fetch("/api/game/alliance/panel")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setAllianceData(json.data); })
      .catch(() => {})
      .finally(() => { setAllianceLoading(false); setAllianceLoaded(true); });
  }, [tab, allianceLoaded]);

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

  async function handleDeposit() {
    if (!depositResource || !depositAmount) return;
    setActionLoading(true); setDepositMsg(null);
    try {
      const res = await fetch("/api/game/alliance/deposit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: depositResource, amount: parseInt(depositAmount, 10) }),
      });
      const json = await res.json();
      setDepositMsg(json.ok ? `Deposited ${depositAmount} ${depositResource}.` : (json.error?.message ?? "Deposit failed."));
      if (json.ok) { setDepositAmount(""); setAllianceLoaded(false); }
    } catch { setDepositMsg("Network error."); }
    finally { setActionLoading(false); }
  }

  async function handleCreate() {
    if (!createName.trim() || !createTag.trim()) return;
    setActionLoading(true); setActionMsg(null);
    try {
      const res = await fetch("/api/game/alliance/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim(), tag: createTag.trim() }),
      });
      const json = await res.json();
      setActionMsg(json.ok ? "Alliance created!" : (json.error?.message ?? "Failed."));
      if (json.ok) { setAllianceLoaded(false); setCreateName(""); setCreateTag(""); }
    } catch { setActionMsg("Network error."); }
    finally { setActionLoading(false); }
  }

  async function handleJoin() {
    if (!joinCode.trim()) return;
    setActionLoading(true); setActionMsg(null);
    try {
      const res = await fetch("/api/game/alliance/join", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: joinCode.trim() }),
      });
      const json = await res.json();
      setActionMsg(json.ok ? "Joined!" : (json.error?.message ?? "Failed."));
      if (json.ok) { setAllianceLoaded(false); setJoinCode(""); }
    } catch { setActionMsg("Network error."); }
    finally { setActionLoading(false); }
  }

  async function handleLeave() {
    setActionLoading(true); setActionMsg(null);
    try {
      const res = await fetch("/api/game/alliance/leave", { method: "POST" });
      const json = await res.json();
      setActionMsg(json.ok ? "Left alliance." : (json.error?.message ?? "Failed."));
      if (json.ok) { setAllianceLoaded(false); setAllianceData(null); }
    } catch { setActionMsg("Network error."); }
    finally { setActionLoading(false); }
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
          {([
            { id: "inbox" as const,    label: `Inbox${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
            { id: "chat" as const,     label: "Alliance Chat" },
            { id: "alliance" as const, label: "Alliance HQ" },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 text-xs font-medium rounded-t transition-colors ${
                tab === t.id ? "bg-zinc-800 text-zinc-200 border-b-2 border-violet-600" : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {t.label}
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
          {tab === "chat" && (
            <div className="space-y-3">
              {chatInAlliance === null && <p className="text-xs text-zinc-600 text-center py-4">Loading…</p>}
              {chatInAlliance === false && (
                <p className="text-sm text-zinc-500 text-center py-4">You are not in an alliance.</p>
              )}
              {chatInAlliance === true && (
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
          {/* ── Alliance HQ tab ───────────────────────────────────────────── */}
          {tab === "alliance" && (
            <div className="space-y-5">
              {allianceLoading && <p className="text-xs text-zinc-600 text-center py-8 animate-pulse">Loading…</p>}

              {/* Not in alliance: create + join forms */}
              {!allianceLoading && allianceData && !allianceData.inAlliance && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Create Alliance</p>
                    <input type="text" placeholder="Alliance name" value={createName} onChange={(e) => setCreateName(e.target.value)}
                      className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                    <input type="text" placeholder="Tag (3–5 chars)" maxLength={5} value={createTag} onChange={(e) => setCreateTag(e.target.value.toUpperCase())}
                      className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
                    <button onClick={handleCreate} disabled={actionLoading || !createName.trim() || !createTag.trim()}
                      className="px-4 py-1.5 text-xs font-semibold rounded border border-violet-700/50 bg-violet-900/20 text-violet-300 hover:bg-violet-800/30 disabled:opacity-50 transition-colors">
                      {actionLoading ? "…" : "Create"}
                    </button>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Join Alliance</p>
                    <input type="text" placeholder="Invite code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)}
                      className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
                    <button onClick={handleJoin} disabled={actionLoading || !joinCode.trim()}
                      className="px-4 py-1.5 text-xs font-semibold rounded border border-indigo-700/50 bg-indigo-900/20 text-indigo-300 hover:bg-indigo-800/30 disabled:opacity-50 transition-colors">
                      {actionLoading ? "…" : "Join"}
                    </button>
                  </div>
                  {actionMsg && <p className="text-xs text-center text-zinc-400">{actionMsg}</p>}
                </div>
              )}

              {/* In alliance */}
              {!allianceLoading && allianceData?.inAlliance && (
                <>
                  {/* Banner */}
                  <div className="rounded-lg border border-violet-800/40 bg-gradient-to-br from-violet-950/40 via-zinc-900/60 to-zinc-900 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-violet-700/50 bg-violet-900/30 px-1.5 py-0.5 text-xs font-bold text-violet-300 font-mono">[{allianceData.alliance?.tag}]</span>
                          <p className="text-sm font-bold text-zinc-100">{allianceData.alliance?.name}</p>
                        </div>
                        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-zinc-500">
                          <span>{allianceData.alliance?.memberCount} members</span>
                          <span className="rounded border border-zinc-700/50 bg-zinc-800/50 px-1.5 py-0.5 text-zinc-400 font-semibold capitalize">{allianceData.myRole}</span>
                          <span className="text-amber-500/80 font-mono">{allianceData.myAllianceCredits?.toLocaleString()} AC</span>
                        </div>
                      </div>
                      {allianceData.alliance?.inviteCode && (
                        <div className="text-right shrink-0">
                          <p className="text-[10px] text-zinc-600">Invite Code</p>
                          <p className="font-mono text-xs font-bold text-zinc-300">{allianceData.alliance.inviteCode}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Goals */}
                  {(allianceData.goals?.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Active Goals</p>
                      <div className="space-y-2">
                        {allianceData.goals!.map((goal) => (
                          <div key={goal.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold text-zinc-200">{goal.title}</p>
                                <p className="text-[10px] text-zinc-600 mt-0.5 capitalize">{goal.resource}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-[10px] text-amber-500 font-semibold">{goal.creditReward.toLocaleString()} AC</p>
                                <p className="text-[10px] text-zinc-600">{goal.pct}%</p>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px] text-zinc-600">
                                <span>{goal.filled.toLocaleString()} / {goal.target.toLocaleString()}</span>
                                <span>{timeAgo(goal.deadlineAt)}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                                <div className={`h-full rounded-full ${goal.pct >= 100 ? "bg-emerald-500" : goal.pct >= 50 ? "bg-indigo-500" : "bg-violet-600"}`} style={{ width: `${Math.min(100, goal.pct)}%` }} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Shared Storage */}
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Shared Storage</p>
                    {(allianceData.storage?.length ?? 0) === 0
                      ? <p className="text-xs text-zinc-600 py-2">Storage is empty.</p>
                      : (
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          {allianceData.storage!.map((s) => (
                            <div key={s.resource} className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 flex flex-col gap-0.5">
                              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 capitalize">{s.resource}</span>
                              <span className="font-mono text-base font-bold text-zinc-200">{s.quantity.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    {(allianceData.stationInventory?.length ?? 0) > 0 && (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                        <p className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wide">Deposit from Station</p>
                        <div className="flex gap-2">
                          <select value={depositResource} onChange={(e) => setDepositResource(e.target.value)}
                            className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500">
                            <option value="">Resource…</option>
                            {allianceData.stationInventory!.map((s) => (
                              <option key={s.resource} value={s.resource}>{s.resource} ({s.quantity.toLocaleString()})</option>
                            ))}
                          </select>
                          <input type="number" min="1" placeholder="Qty" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
                            className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs font-mono text-zinc-200 text-center focus:outline-none focus:border-zinc-500" />
                          <button onClick={handleDeposit} disabled={actionLoading || !depositResource || !depositAmount}
                            className="shrink-0 rounded px-3 py-1.5 text-xs font-semibold border border-teal-700/50 bg-teal-950/20 text-teal-400 hover:bg-teal-900/30 disabled:opacity-50 transition-colors">
                            {actionLoading ? "…" : "Deposit"}
                          </button>
                        </div>
                        {depositMsg && <p className="text-xs text-zinc-400">{depositMsg}</p>}
                      </div>
                    )}
                  </div>

                  {/* Members */}
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Members ({allianceData.members?.length ?? 0})</p>
                    <div className="space-y-1.5">
                      {(allianceData.members ?? []).map((m) => (
                        <div key={m.id} className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-3 ${m.isSelf ? "border-violet-800/40 bg-violet-950/20" : "border-zinc-800 bg-zinc-900/40"}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-800 border border-zinc-600/50 flex items-center justify-center shrink-0">
                              <span className="text-[10px] font-bold text-zinc-300">{m.handle[0]?.toUpperCase()}</span>
                            </div>
                            <div className="min-w-0">
                              <p className={`text-xs font-semibold truncate ${m.isSelf ? "text-violet-300" : "text-zinc-200"}`}>{m.handle}{m.isSelf && " (you)"}</p>
                              <span className="rounded border border-zinc-700/50 bg-zinc-800/50 px-1 py-0.5 text-[9px] font-semibold text-zinc-400 capitalize">{m.role}</span>
                            </div>
                          </div>
                          <span className="font-mono text-[10px] text-amber-500/80 shrink-0">{m.allianceCredits.toLocaleString()} AC</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Leave */}
                  <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                    {actionMsg && <p className="text-xs text-zinc-500">{actionMsg}</p>}
                    <button onClick={handleLeave} disabled={actionLoading}
                      className="ml-auto px-4 py-1.5 text-xs font-semibold rounded border border-red-900/40 bg-red-950/20 text-red-500 hover:bg-red-900/30 disabled:opacity-50 transition-colors">
                      Leave Alliance
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
