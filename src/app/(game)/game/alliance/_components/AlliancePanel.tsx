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
// Small reusable UI pieces (alliance-specific)
// ---------------------------------------------------------------------------

function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
        <span className="inline-block h-3.5 w-0.5 rounded-full bg-indigo-700" />
        {title}
      </h3>
      {meta !== undefined && (
        <span className="text-xs text-zinc-600 tabular-nums">{meta}</span>
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: AllianceRole }) {
  const styles: Record<AllianceRole, string> = {
    founder: "bg-amber-900/50 border border-amber-700/50 text-amber-300",
    officer: "bg-indigo-900/50 border border-indigo-700/50 text-indigo-300",
    member:  "bg-zinc-800/80 border border-zinc-700/40 text-zinc-500",
  };
  const labels: Record<AllianceRole, string> = {
    founder: "★ Founder",
    officer: "◈ Officer",
    member:  "Member",
  };
  return (
    <span className={`rounded px-2.5 py-1 text-xs font-semibold tracking-wide ${styles[role]}`}>
      {labels[role]}
    </span>
  );
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
      <div className="space-y-5">
        {/* Atmospheric intro */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-8 text-center">
          <div className="mb-3 font-mono text-3xl font-black tracking-widest text-zinc-800 select-none">
            ◉
          </div>
          <p className="text-sm font-semibold text-zinc-300 mb-1.5">No Faction</p>
          <p className="text-xs text-zinc-600 max-w-xs mx-auto leading-relaxed">
            Found or join an alliance to place beacons, claim territory, and
            coordinate with other commanders.
          </p>
        </div>

        {/* Feedback */}
        {actionError   && <p className="text-sm text-red-400 px-1">{actionError}</p>}
        {actionSuccess && <p className="text-sm text-emerald-400 px-1">{actionSuccess}</p>}

        {/* Found */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block h-3.5 w-0.5 rounded-full bg-indigo-700" />
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
              Found an Alliance
            </h2>
          </div>
          <p className="text-xs text-zinc-600 mb-5 leading-relaxed">
            Establish your faction. Other commanders can join using the invite code.
            Costs 100 iron from your station inventory.
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                Alliance Name <span className="text-zinc-700">(3–40 characters)</span>
              </label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={40}
                placeholder="e.g. Iron Vanguard"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-700 focus:border-indigo-600 focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                Tag <span className="text-zinc-700">(2–5 alphanumeric · shown on map)</span>
              </label>
              <input
                type="text"
                value={createTag}
                onChange={(e) => setCreateTag(e.target.value.toUpperCase())}
                maxLength={5}
                placeholder="IRNV"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono font-bold text-indigo-200 placeholder-zinc-700 focus:border-indigo-600 focus:outline-none transition-colors"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={actionLoading || createName.length < 3 || createTag.length < 2}
              className="w-full rounded-lg border border-indigo-700 bg-indigo-950/70 px-4 py-2.5 text-sm font-semibold text-indigo-300 hover:bg-indigo-900/70 hover:border-indigo-600 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? "Creating…" : "Found Alliance"}
            </button>
          </div>
        </section>

        {/* Join */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block h-3.5 w-0.5 rounded-full bg-zinc-600" />
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
              Join an Alliance
            </h2>
          </div>
          <p className="text-xs text-zinc-600 mb-5">
            Enter an invite code shared by an alliance founder.
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-500">Invite Code</label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toLowerCase())}
                maxLength={64}
                placeholder="e.g. a1b2c3d4"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono text-zinc-200 placeholder-zinc-700 focus:border-zinc-500 focus:outline-none transition-colors"
              />
            </div>
            <button
              onClick={handleJoin}
              disabled={actionLoading || joinCode.length < 1}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-700/60 hover:border-zinc-600 disabled:opacity-50 transition-colors"
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

      {/* ── Alliance Identity Panel ──────────────────────────────────────── */}
      <div className="rounded-xl border border-indigo-900/60 bg-gradient-to-br from-indigo-950/40 via-zinc-900 to-zinc-900 px-6 py-5 shadow-lg shadow-black/30">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {/* Tag + name */}
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-mono text-2xl font-black tracking-widest text-indigo-200 border border-indigo-700/60 bg-indigo-950/70 px-2.5 py-0.5 rounded-md leading-tight">
                [{alliance.tag}]
              </span>
              <h2 className="text-xl font-bold text-zinc-100 truncate">{alliance.name}</h2>
            </div>
            {/* Stats row */}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 shrink-0" />
                <span className="font-semibold text-zinc-300 tabular-nums">{alliance.memberCount}</span>
                <span className="text-zinc-600">{alliance.memberCount === 1 ? "member" : "members"}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span className="font-semibold text-zinc-300 tabular-nums">{activeBeaconCount}</span>
                <span className="text-zinc-600">/ 20 beacons</span>
              </span>
              {territory.hasValidTerritory && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
                  <span className="font-semibold text-indigo-300 tabular-nums">{territory.systemCount}</span>
                  <span className="text-indigo-600">
                    {territory.systemCount === 1 ? "system" : "systems"} claimed
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Role badge + leave */}
          <div className="shrink-0 flex flex-col items-end gap-2">
            <RoleBadge role={membership.role} />
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
          <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-1.5">
              Invite Code
            </p>
            <p className="font-mono text-sm text-zinc-300 select-all break-all">
              {alliance.inviteCode}
            </p>
            <p className="mt-1.5 text-[10px] text-zinc-700">
              Share with players to let them join your alliance.
            </p>
          </div>
        )}
      </div>

      {/* Feedback */}
      {actionError && <p className="text-sm text-red-400 px-1">{actionError}</p>}

      {/* ── Members ───────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
        <SectionHeading title="Members" meta={String(members.length)} />
        <div className="divide-y divide-zinc-800/60">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-2.5 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-sm truncate ${
                  m.playerId === playerId
                    ? "font-semibold text-zinc-200"
                    : "text-zinc-400"
                }`}>
                  {m.handle}
                </span>
                {m.playerId === playerId && (
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 shrink-0">
                    you
                  </span>
                )}
              </div>
              <div className="shrink-0">
                <RoleBadge role={m.role} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Manage Roles (founder only) ───────────────────────────────────── */}
      {isFounder && otherMembers.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
          <SectionHeading title="Manage Roles" />
          {promoteError && <p className="mb-3 text-xs text-red-400">{promoteError}</p>}
          <div className="flex flex-wrap gap-2">
            <select
              value={promoteTarget}
              onChange={(e) => setPromoteTarget(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 focus:border-zinc-500 focus:outline-none"
            >
              <option value="">Select member…</option>
              {otherMembers.map((m) => (
                <option key={m.id} value={m.playerId}>
                  {m.handle} ({roleLabel(m.role)})
                </option>
              ))}
            </select>
            <select
              value={promoteRole}
              onChange={(e) => setPromoteRole(e.target.value as typeof promoteRole)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 focus:border-zinc-500 focus:outline-none"
            >
              <option value="officer">→ Officer</option>
              <option value="member">→ Member</option>
              <option value="founder">→ Transfer Leadership</option>
            </select>
            <button
              onClick={handlePromote}
              disabled={promoteLoading || !promoteTarget}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {promoteLoading ? "Saving…" : "Apply"}
            </button>
          </div>
        </div>
      )}

      {/* ── Beacons ───────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
        <SectionHeading
          title="Territory Beacons"
          meta={`${activeBeaconCount} / 20 active`}
        />

        {/* Place beacon control (officer / founder) */}
        {isPrivileged && (
          <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 space-y-2.5">
            {beaconError && <p className="text-xs text-red-400">{beaconError}</p>}
            <p className="text-xs text-zinc-600">
              Place a beacon on any catalog system · 50 iron per beacon
            </p>
            <div className="flex gap-2">
              <select
                value={beaconSystem}
                onChange={(e) => setBeaconSystem(e.target.value)}
                className="flex-1 min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 focus:border-indigo-600 focus:outline-none"
              >
                <option value="">Select system…</option>
                {catalogSystems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                onClick={handlePlaceBeacon}
                disabled={beaconLoading || !beaconSystem}
                className="shrink-0 rounded-lg border border-indigo-700 bg-indigo-950/70 px-4 py-2 text-sm font-semibold text-indigo-300 hover:bg-indigo-900/70 hover:border-indigo-600 disabled:opacity-50 transition-colors"
              >
                {beaconLoading ? "Placing…" : "Place Beacon"}
              </button>
            </div>
          </div>
        )}

        {/* Beacon list */}
        {beacons.length === 0 ? (
          <div className="py-5 text-center">
            <p className="text-xs text-zinc-700">No beacons placed yet.</p>
            {isPrivileged && (
              <p className="mt-1 text-xs text-zinc-800">
                Place beacons on catalog systems to begin claiming territory.
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {beacons.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-2.5 gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                  <span className="text-sm text-zinc-300 truncate">{b.systemName}</span>
                  <span className="text-xs text-zinc-700 shrink-0">
                    {new Date(b.placedAt).toLocaleDateString()}
                  </span>
                </div>
                {isPrivileged && (
                  <button
                    onClick={() => handleRemoveBeacon(b.id)}
                    disabled={beaconLoading}
                    className="shrink-0 text-xs text-zinc-700 hover:text-red-400 transition-colors disabled:opacity-50"
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
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
        <SectionHeading title="Territory Control" />

        {activeBeaconCount < 3 ? (
          <div className="space-y-3">
            {/* Progress pips */}
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`h-2.5 w-2.5 rounded-sm border transition-colors ${
                    i < activeBeaconCount
                      ? "bg-indigo-600 border-indigo-500"
                      : "bg-zinc-800 border-zinc-700"
                  }`}
                />
              ))}
              <span className="ml-1 text-xs text-zinc-600">
                {activeBeaconCount === 0
                  ? "3 beacons needed to form a territory loop"
                  : `${3 - activeBeaconCount} more beacon${3 - activeBeaconCount !== 1 ? "s" : ""} needed`}
              </span>
            </div>
            <p className="text-xs text-zinc-700 leading-relaxed">
              Place beacons on systems within 10 ly of each other. Three linked
              beacons form a closed loop and activate territory control.
            </p>
          </div>
        ) : !territory.hasValidTerritory ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs text-amber-600">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-600 shrink-0" />
              {activeBeaconCount} beacons placed — no valid loop detected
            </div>
            <p className="text-xs text-zinc-700 leading-relaxed">
              Ensure beacon systems are within 10 ly of each other (2D map
              distance) to form a closed territory loop.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Territory active
              </span>
              <span className="text-zinc-700">·</span>
              <span className="text-zinc-500">{territory.linkCount} beacon links</span>
              <span className="text-zinc-700">·</span>
              <span className="text-indigo-400 font-semibold">
                {territory.systemCount}{" "}
                {territory.systemCount === 1 ? "system" : "systems"} claimed
              </span>
            </div>
            {territory.systemNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {territory.systemNames.map((name) => (
                  <span
                    key={name}
                    className="rounded-md border border-indigo-800/50 bg-indigo-950/60 px-2 py-1 text-xs text-indigo-300"
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
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
          <SectionHeading title="Disputes" meta={String(disputes.length)} />
          {disputeError && <p className="mb-3 text-xs text-red-400">{disputeError}</p>}
          <div className="space-y-3">
            {disputes.map((d) => {
              const isOpen        = d.status === "open";
              const msLeft        = new Date(d.resolvesAt).getTime() - Date.now();
              const hLeft         = Math.max(0, msLeft / (1000 * 60 * 60));
              const timeStr       = hLeft < 1
                ? `${Math.ceil(hLeft * 60)} min`
                : `${hLeft.toFixed(1)} hr`;
              const loading       = disputeLoading[d.id] ?? false;
              const selectedFleet = disputeFleetId[d.id] ?? "";

              const chipStyle = isOpen
                ? "border-orange-800/60 bg-orange-950/60 text-orange-300"
                : d.status === "resolved"
                  ? d.winnerAllianceId === alliance?.id
                    ? "border-emerald-800/60 bg-emerald-950/60 text-emerald-300"
                    : "border-red-800/60 bg-red-950/60 text-red-400"
                  : "border-zinc-700/60 bg-zinc-800/60 text-zinc-500";

              const chipLabel = isOpen
                ? "Open"
                : d.status === "resolved"
                  ? d.winnerAllianceId === alliance?.id ? "Won" : "Lost"
                  : "Expired";

              return (
                <div
                  key={d.id}
                  className={`rounded-lg border p-4 ${
                    isOpen
                      ? "border-orange-800/40 bg-orange-950/20"
                      : "border-zinc-800 bg-zinc-900/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-200 truncate">
                        {d.beaconSystemName}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-600">
                        {d.isDefender
                          ? "Defending — attacker challenging your beacon"
                          : "Attacking — you are challenging this beacon"}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded border px-2 py-0.5 text-xs font-semibold ${chipStyle}`}>
                      {chipLabel}
                    </span>
                  </div>

                  {isOpen && (
                    <div className="mt-2 text-xs font-medium text-orange-500">
                      Resolves in ~{timeStr}
                    </div>
                  )}
                  {!isOpen && d.resolvedAt && (
                    <div className="mt-1.5 text-xs text-zinc-700">
                      Resolved {new Date(d.resolvedAt).toLocaleDateString()}
                    </div>
                  )}

                  {isOpen && (
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        placeholder="Fleet ID to commit…"
                        value={selectedFleet}
                        onChange={(e) =>
                          setDisputeFleetId((prev) => ({ ...prev, [d.id]: e.target.value }))
                        }
                        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                      />
                      <button
                        onClick={() => handleReinforce(d.id)}
                        disabled={loading || !selectedFleet}
                        className="shrink-0 rounded-lg border border-orange-700 bg-orange-950/60 px-3 py-1.5 text-xs font-semibold text-orange-300 hover:bg-orange-900/60 disabled:opacity-50 transition-colors"
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
