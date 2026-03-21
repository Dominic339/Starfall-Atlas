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
  beacons: {
    id: string;
    systemId: string;
    systemName: string;
    placedAt: string;
  }[];
  activeBeaconCount: number;
  catalogSystems: { id: string; name: string }[];
  playerId: string;
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
    <div className="space-y-6">
      {/* Feedback */}
      {actionError && <p className="text-sm text-red-400">{actionError}</p>}

      {/* Alliance info */}
      <section className="rounded border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-indigo-400 bg-indigo-950/60 border border-indigo-800/50 px-1.5 py-0.5 rounded">
                [{alliance.tag}]
              </span>
              <h2 className="text-base font-semibold text-zinc-100">{alliance.name}</h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {alliance.memberCount} {alliance.memberCount === 1 ? "member" : "members"} ·{" "}
              {activeBeaconCount} {activeBeaconCount === 1 ? "beacon" : "beacons"} active
            </p>
          </div>
          <span className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
            {roleLabel(membership.role)}
          </span>
        </div>

        {/* Invite code (founder only) */}
        {isFounder && (
          <div className="mt-4 rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
            <p className="text-xs text-zinc-600">Invite code — share with players you want to recruit:</p>
            <p className="mt-0.5 font-mono text-sm text-zinc-300 select-all">{alliance.inviteCode}</p>
          </div>
        )}

        {/* Leave */}
        {!isFounder && (
          <button
            onClick={handleLeave}
            disabled={actionLoading}
            className="mt-4 text-xs text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-50"
          >
            Leave alliance
          </button>
        )}
      </section>

      {/* Members */}
      <section className="rounded border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Members ({members.length})</h2>
        <div className="divide-y divide-zinc-800/50">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-300">{m.handle}</span>
              <span className={`text-xs ${
                m.role === "founder" ? "text-amber-400" :
                m.role === "officer" ? "text-indigo-400" :
                "text-zinc-500"
              }`}>
                {roleLabel(m.role)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Promote (founder only) */}
      {isFounder && otherMembers.length > 0 && (
        <section className="rounded border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Manage Roles</h2>
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
        </section>
      )}

      {/* Beacons */}
      <section className="rounded border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-1 text-sm font-semibold text-zinc-200">Beacons</h2>
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
      </section>
    </div>
  );
}
