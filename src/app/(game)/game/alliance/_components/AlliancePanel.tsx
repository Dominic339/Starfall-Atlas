"use client";

/**
 * AlliancePanel — client component for all interactive alliance actions.
 *
 * Receives server-rendered state as props; uses fetch() to call server-
 * authoritative API routes and refreshes via router.refresh() on success.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AllianceRole } from "@/lib/types/enums";

// ---------------------------------------------------------------------------
// Prop types
// ---------------------------------------------------------------------------

export interface DisputePanelEntry {
  id: string;
  beaconId: string;
  beaconSystemId: string;
  beaconSystemName: string;
  defendingAllianceId: string;
  attackingAllianceId: string;
  status: string;
  openedAt: string;
  resolvesAt: string;
  resolvedAt: string | null;
  winnerAllianceId: string | null;
  /** True if this alliance is the defender (owns the beacon). */
  isDefender: boolean;
}

export interface AlliancePanelProps {
  // null when player has no alliance
  alliance: {
    id: string;
    name: string;
    tag: string;
    inviteCode: string;
    memberCount: number;
  } | null;
  membership: {
    role: AllianceRole;
  } | null;
  members: {
    id: string;
    playerId: string;
    handle: string;
    role: AllianceRole;
  }[];
  /** Territory summary computed server-side. */
  territory: {
    hasValidTerritory: boolean;
    systemCount: number;
    systemNames: string[];
    linkCount: number;
  };
  beacons: {
    id: string;
    systemId: string;
    systemName: string;
    placedAt: string;
  }[];
  activeBeaconCount: number;
  catalogSystems: { id: string; name: string }[];
  playerId: string;
  /** Recent disputes involving this alliance (up to 20, newest first). */
  disputes: DisputePanelEntry[];
}

// ---------------------------------------------------------------------------
// Role helpers
// ---------------------------------------------------------------------------

function roleLabel(role: AllianceRole): string {
  switch (role) {
    case "founder": return "Founder";
    case "officer": return "Officer";
    case "member":  return "Member";
  }
}

function canManageBeacons(role: AllianceRole): boolean {
  return role === "founder" || role === "officer";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AlliancePanel({
  alliance,
  membership,
  members,
  beacons,
  activeBeaconCount,
  catalogSystems,
  playerId,
  territory,
  disputes,
}: AlliancePanelProps) {
  const router = useRouter();

  // ── No alliance: create/join forms ────────────────────────────────────────
  const [createName, setCreateName]   = useState("");
  const [createTag, setCreateTag]     = useState("");
  const [joinCode, setJoinCode]       = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError]   = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // ── Beacon placement ──────────────────────────────────────────────────────
  const [beaconSystem, setBeaconSystem] = useState("");
  const [beaconLoading, setBeaconLoading] = useState(false);
  const [beaconError, setBeaconError]   = useState<string | null>(null);

  // ── Promote ───────────────────────────────────────────────────────────────
  const [promoteTarget, setPromoteTarget] = useState("");
  const [promoteRole, setPromoteRole]     = useState<"officer" | "member" | "founder">("officer");
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [promoteError, setPromoteError]   = useState<string | null>(null);

  // ── Dispute actions ───────────────────────────────────────────────────────
  const [disputeFleetId, setDisputeFleetId] = useState<Record<string, string>>({});
  const [disputeLoading, setDisputeLoading] = useState<Record<string, boolean>>({});
  const [disputeError, setDisputeError]     = useState<string | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────
  async function callApi(url: string, body: object): Promise<string | null> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) return json.error?.message ?? "Unknown error";
    return null;
  }

  async function handleCreate() {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    const err = await callApi("/api/game/alliance/create", { name: createName, tag: createTag });
    setActionLoading(false);
    if (err) { setActionError(err); return; }
    setActionSuccess("Alliance created!");
    router.refresh();
  }

  async function handleJoin() {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    const err = await callApi("/api/game/alliance/join", { inviteCode: joinCode });
    setActionLoading(false);
    if (err) { setActionError(err); return; }
    setActionSuccess("Joined alliance!");
    router.refresh();
  }

  async function handleLeave() {
    if (!confirm("Are you sure you want to leave your alliance?")) return;
    setActionLoading(true);
    setActionError(null);
    const err = await callApi("/api/game/alliance/leave", {});
    setActionLoading(false);
    if (err) { setActionError(err); return; }
    router.refresh();
  }

  async function handlePlaceBeacon() {
    if (!beaconSystem) return;
    setBeaconLoading(true);
    setBeaconError(null);
    const err = await callApi("/api/game/alliance/beacon/place", { systemId: beaconSystem });
    setBeaconLoading(false);
    if (err) { setBeaconError(err); return; }
    setBeaconSystem("");
    router.refresh();
  }

  async function handleRemoveBeacon(beaconId: string) {
    setBeaconLoading(true);
    setBeaconError(null);
    const err = await callApi("/api/game/alliance/beacon/remove", { beaconId });
    setBeaconLoading(false);
    if (err) { setBeaconError(err); return; }
    router.refresh();
  }

  async function handlePromote() {
    if (!promoteTarget) return;
    setPromoteLoading(true);
    setPromoteError(null);
    const err = await callApi("/api/game/alliance/promote", {
      targetPlayerId: promoteTarget,
      newRole: promoteRole,
    });
    setPromoteLoading(false);
    if (err) { setPromoteError(err); return; }
    setPromoteTarget("");
    router.refresh();
  }

  async function handleReinforce(disputeId: string) {
    const fleetId = disputeFleetId[disputeId];
    if (!fleetId) return;
    setDisputeLoading((prev) => ({ ...prev, [disputeId]: true }));
    setDisputeError(null);
    const err = await callApi("/api/game/dispute/reinforce", { disputeId, fleetId });
    setDisputeLoading((prev) => ({ ...prev, [disputeId]: false }));
    if (err) { setDisputeError(err); return; }
    router.refresh();
  }

  // ── No alliance ───────────────────────────────────────────────────────────
  if (!alliance || !membership) {
    return (
      <div className="space-y-8">
        {/* Feedback */}
        {actionError   && <p className="text-sm text-red-400">{actionError}</p>}
        {actionSuccess && <p className="text-sm text-emerald-400">{actionSuccess}</p>}

        {/* Create */}
        <section className="rounded border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Found an Alliance</h2>
          <p className="mb-4 text-xs text-zinc-500">
            Cost: 100 iron from your station inventory.
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Alliance Name (3–40 chars)</label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={40}
                placeholder="e.g. Iron Vanguard"
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Tag (2–5 alphanumeric, shown on map)</label>
              <input
                type="text"
                value={createTag}
                onChange={(e) => setCreateTag(e.target.value.toUpperCase())}
                maxLength={5}
                placeholder="e.g. IRNV"
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-mono text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={actionLoading || createName.length < 3 || createTag.length < 2}
              className="rounded border border-indigo-700 bg-indigo-950/60 px-4 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-900/60 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? "Creating…" : "Found Alliance"}
            </button>
          </div>
        </section>

        {/* Join */}
        <section className="rounded border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Join an Alliance</h2>
          <p className="mb-4 text-xs text-zinc-500">
            Enter an invite code shared by an alliance founder.
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Invite Code</label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toLowerCase())}
                maxLength={64}
                placeholder="e.g. a1b2c3d4"
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-mono text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <button
              onClick={handleJoin}
              disabled={actionLoading || joinCode.length < 1}
              className="rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? "Joining…" : "Join Alliance"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  // ── In alliance ───────────────────────────────────────────────────────────
  const isPrivileged = canManageBeacons(membership.role);
  const isFounder    = membership.role === "founder";
  const otherMembers = members.filter((m) => m.playerId !== playerId);

  return (
    <div className="space-y-4">
      {/* ── Guild header ──────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-indigo-900/60 bg-zinc-900 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-sm font-bold text-indigo-300 bg-indigo-950/70 border border-indigo-700/60 px-2 py-0.5 rounded">
                [{alliance.tag}]
              </span>
              <h2 className="text-lg font-semibold text-zinc-100">{alliance.name}</h2>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
              <span>{alliance.memberCount} {alliance.memberCount === 1 ? "member" : "members"}</span>
              <span>{activeBeaconCount} {activeBeaconCount === 1 ? "beacon" : "beacons"}</span>
              {territory.hasValidTerritory && (
                <span className="text-indigo-400">{territory.systemCount} system{territory.systemCount !== 1 ? "s" : ""} claimed</span>
              )}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1.5">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${
              membership.role === "founder"
                ? "bg-amber-900/40 text-amber-400"
                : membership.role === "officer"
                  ? "bg-indigo-900/40 text-indigo-400"
                  : "bg-zinc-800 text-zinc-400"
            }`}>
              {roleLabel(membership.role)}
            </span>
            {!isFounder && (
              <button
                onClick={handleLeave}
                disabled={actionLoading}
                className="text-xs text-zinc-700 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                Leave
              </button>
            )}
          </div>
        </div>

        {/* Invite code (founder only) */}
        {isFounder && (
          <div className="mt-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
            <p className="text-xs text-zinc-600">Invite code:</p>
            <p className="mt-0.5 font-mono text-sm text-zinc-300 select-all">{alliance.inviteCode}</p>
          </div>
        )}
      </div>

      {/* ── Members ───────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Members ({members.length})
        </h3>
        <div className="divide-y divide-zinc-800/50">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-2">
              <span className={`text-sm ${m.playerId === playerId ? "text-zinc-200 font-medium" : "text-zinc-400"}`}>
                {m.handle}
                {m.playerId === playerId && <span className="ml-1.5 text-xs text-zinc-600">(you)</span>}
              </span>
              <span className={`text-xs ${
                m.role === "founder" ? "text-amber-400" :
                m.role === "officer" ? "text-indigo-400" :
                "text-zinc-600"
              }`}>
                {roleLabel(m.role)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Feedback */}
      {actionError && <p className="text-sm text-red-400">{actionError}</p>}

      {/* ── Management actions (founder only) ─────────────────────────────── */}
      {isFounder && otherMembers.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Manage Roles
          </h3>
          {promoteError && <p className="mb-2 text-xs text-red-400">{promoteError}</p>}
          <div className="flex flex-wrap gap-2">
            <select
              value={promoteTarget}
              onChange={(e) => setPromoteTarget(e.target.value)}
              className="flex-1 min-w-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-300 focus:border-zinc-500 focus:outline-none"
            >
              <option value="">Select member…</option>
              {otherMembers.map((m) => (
                <option key={m.id} value={m.playerId}>{m.handle} ({roleLabel(m.role)})</option>
              ))}
            </select>
            <select
              value={promoteRole}
              onChange={(e) => setPromoteRole(e.target.value as typeof promoteRole)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-300 focus:border-zinc-500 focus:outline-none"
            >
              <option value="officer">→ Officer</option>
              <option value="member">→ Member</option>
              <option value="founder">→ Transfer Leadership</option>
            </select>
            <button
              onClick={handlePromote}
              disabled={promoteLoading || !promoteTarget}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {promoteLoading ? "Saving…" : "Apply"}
            </button>
          </div>
        </div>
      )}

      {/* ── Beacons ───────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Beacons</h3>
        <p className="mb-3 text-xs text-zinc-600">
          {activeBeaconCount} active · max 20
        </p>

        {/* Place beacon (officer/founder) */}
        {isPrivileged && (
          <div className="mb-4 space-y-2">
            {beaconError && <p className="text-xs text-red-400">{beaconError}</p>}
            <p className="text-xs text-zinc-500">Cost: 50 iron from station inventory.</p>
            <div className="flex gap-2">
              <select
                value={beaconSystem}
                onChange={(e) => setBeaconSystem(e.target.value)}
                className="flex-1 min-w-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-300 focus:border-zinc-500 focus:outline-none"
              >
                <option value="">Select system…</option>
                {catalogSystems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                onClick={handlePlaceBeacon}
                disabled={beaconLoading || !beaconSystem}
                className="shrink-0 rounded border border-indigo-700 bg-indigo-950/60 px-3 py-1.5 text-sm text-indigo-300 hover:bg-indigo-900/60 disabled:opacity-50 transition-colors"
              >
                {beaconLoading ? "Placing…" : "Place Beacon"}
              </button>
            </div>
          </div>
        )}

        {/* Beacon list */}
        {beacons.length === 0 ? (
          <p className="text-xs text-zinc-700">No beacons placed yet.</p>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {beacons.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm text-zinc-300">{b.systemName}</span>
                  <span className="ml-2 text-xs text-zinc-600">
                    {new Date(b.placedAt).toLocaleDateString()}
                  </span>
                </div>
                {isPrivileged && (
                  <button
                    onClick={() => handleRemoveBeacon(b.id)}
                    disabled={beaconLoading}
                    className="text-xs text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Territory ─────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Territory</h3>
        {activeBeaconCount < 3 ? (
          <p className="text-xs text-zinc-600">
            Place at least 3 beacons to form a territory loop.{" "}
            {activeBeaconCount > 0 && `(${activeBeaconCount}/3 placed)`}
          </p>
        ) : !territory.hasValidTerritory ? (
          <p className="text-xs text-zinc-600">
            {activeBeaconCount} beacons placed, but no valid territory loop detected.
            Ensure beacon systems are within 10 ly of each other (2D map distance).
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-zinc-400">
              Active territory loop · {territory.linkCount} beacon links ·{" "}
              <span className="text-indigo-400">
                {territory.systemCount} {territory.systemCount === 1 ? "system" : "systems"} claimed
              </span>
            </p>
            {territory.systemNames.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {territory.systemNames.map((name) => (
                  <span
                    key={name}
                    className="rounded bg-indigo-950/60 border border-indigo-800/40 px-1.5 py-0.5 text-xs text-indigo-300"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-zinc-700">
              Beacons inside your territory loop are protected from disputes.
            </p>
          </div>
        )}
      </div>

      {/* ── Disputes ──────────────────────────────────────────────────────── */}
      {disputes.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Disputes</h3>
          {disputeError && <p className="mb-2 text-xs text-red-400">{disputeError}</p>}
          <div className="space-y-3">
            {disputes.map((d) => {
              const isOpen       = d.status === "open";
              const now          = Date.now();
              const msLeft       = new Date(d.resolvesAt).getTime() - now;
              const hLeft        = Math.max(0, msLeft / (1000 * 60 * 60));
              const timeStr      = hLeft < 1
                ? `${Math.ceil(hLeft * 60)} min`
                : `${hLeft.toFixed(1)} hr`;
              const loading      = disputeLoading[d.id] ?? false;
              const selectedFleet = disputeFleetId[d.id] ?? "";

              return (
                <div
                  key={d.id}
                  className={`rounded border p-3 ${
                    isOpen
                      ? "border-orange-800/50 bg-orange-950/20"
                      : "border-zinc-800 bg-zinc-900/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-zinc-300 truncate">
                        {d.beaconSystemName}
                        {d.isDefender
                          ? <span className="ml-1.5 text-orange-400">(your beacon)</span>
                          : <span className="ml-1.5 text-indigo-400">(challenge)</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-600">
                        {d.isDefender ? "Attacker challenging you" : "You are challenging"}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                        isOpen
                          ? "bg-orange-900/60 text-orange-300"
                          : d.status === "resolved"
                            ? d.winnerAllianceId === alliance?.id
                              ? "bg-emerald-900/60 text-emerald-300"
                              : "bg-red-900/60 text-red-400"
                            : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {isOpen
                        ? "Open"
                        : d.status === "resolved"
                          ? d.winnerAllianceId === alliance?.id
                            ? "Won"
                            : "Lost"
                          : "Expired"}
                    </span>
                  </div>

                  {isOpen && (
                    <div className="mt-1.5 text-xs text-orange-600">
                      Resolves in ~{timeStr}
                    </div>
                  )}
                  {!isOpen && d.resolvedAt && (
                    <div className="mt-1 text-xs text-zinc-700">
                      Resolved {new Date(d.resolvedAt).toLocaleDateString()}
                    </div>
                  )}

                  {/* Reinforce button (only for open disputes) */}
                  {isOpen && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        placeholder="Fleet ID to commit…"
                        value={selectedFleet}
                        onChange={(e) =>
                          setDisputeFleetId((prev) => ({ ...prev, [d.id]: e.target.value }))
                        }
                        className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                      />
                      <button
                        onClick={() => handleReinforce(d.id)}
                        disabled={loading || !selectedFleet}
                        className="shrink-0 rounded border border-orange-700 bg-orange-950/60 px-2.5 py-1 text-xs text-orange-300 hover:bg-orange-900/60 disabled:opacity-50 transition-colors"
                      >
                        {loading ? "…" : "Reinforce"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
