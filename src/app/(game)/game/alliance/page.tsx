/**
 * /game/alliance — Alliance management page (Phase 23)
 *
 * Server component. Fetches:
 *   - Player's current alliance membership (if any)
 *   - Alliance details and full member list
 *   - Active beacons placed by the alliance
 *   - Full catalog system list (for beacon placement selector)
 *
 * All mutations are delegated to the AlliancePanel client component which
 * calls server-authoritative API routes.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getAllCatalogEntries } from "@/lib/catalog";
import { BALANCE } from "@/lib/config/balance";
import { computeAllTerritories } from "@/lib/game/territory";
import { resolveOverdueDisputes } from "@/lib/game/disputeResolution";
import type { Player } from "@/lib/types/game";
import type { AllianceRole } from "@/lib/types/enums";
import { AlliancePanel } from "./_components/AlliancePanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alliance — Starfall Atlas" };

export default async function AlliancePage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("id, handle").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // ── Lazy dispute resolution ───────────────────────────────────────────────
  await resolveOverdueDisputes(admin);

  // ── Fetch membership ──────────────────────────────────────────────────────
  type MembershipRow = { id: string; alliance_id: string; role: AllianceRole };
  const { data: membership } = maybeSingleResult<MembershipRow>(
    await admin
      .from("alliance_members")
      .select("id, alliance_id, role")
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  let allianceData: {
    id: string;
    name: string;
    tag: string;
    inviteCode: string;
    memberCount: number;
  } | null = null;

  type MemberWithHandle = {
    id: string;
    playerId: string;
    handle: string;
    role: AllianceRole;
    allianceCredits: number;
  };
  let members: MemberWithHandle[] = [];

  type GoalEntry = {
    id: string;
    title: string;
    resourceType: string;
    quantityTarget: number;
    quantityFilled: number;
    creditReward: number;
    deadlineAt: string;
    completedAt: string | null;
  };
  let goals: GoalEntry[] = [];

  type StorageEntry = { resourceType: string; quantity: number };
  let storage: StorageEntry[] = [];

  type StationEntry = { resourceType: string; quantity: number };
  let stationInventory: StationEntry[] = [];
  let playerAllianceCredits = 0;

  type BeaconRow = { id: string; systemId: string; systemName: string; placedAt: string };
  let beacons: BeaconRow[] = [];
  let activeBeaconCount = 0;

  const pageNow = new Date();

  if (membership) {
    type AllianceRow    = { id: string; name: string; tag: string; invite_code: string; member_count: number };
    type RawMemberRow   = { id: string; player_id: string; role: AllianceRole; alliance_credits: number };
    type RawBeaconRow   = { id: string; system_id: string; placed_at: string };
    type RawGoalRow     = { id: string; title: string; resource_type: string; quantity_target: number; quantity_filled: number; credit_reward: number; deadline_at: string; completed_at: string | null };
    type RawStorageRow  = { resource_type: string; quantity: number };

    const nowIso = pageNow.toISOString();

    // ── Batch 1: all independent membership queries in parallel ────────────
    const [allianceRes, membersRes, beaconsRes, goalsRes, storageRes, stationRes] = await Promise.all([
      admin.from("alliances").select("id, name, tag, invite_code, member_count").eq("id", membership.alliance_id).maybeSingle(),
      admin.from("alliance_members").select("id, player_id, role, alliance_credits").eq("alliance_id", membership.alliance_id).order("joined_at", { ascending: true }),
      admin.from("alliance_beacons").select("id, system_id, placed_at").eq("alliance_id", membership.alliance_id).eq("is_active", true).order("placed_at", { ascending: true }),
      admin.from("alliance_goals").select("id, title, resource_type, quantity_target, quantity_filled, credit_reward, deadline_at, completed_at").eq("alliance_id", membership.alliance_id).eq("expired", false).is("completed_at", null).gt("deadline_at", nowIso).order("deadline_at", { ascending: true }),
      admin.from("resource_inventory").select("resource_type, quantity").eq("location_type", "alliance_storage").eq("location_id", membership.alliance_id),
      admin.from("player_stations").select("id").eq("owner_id", player.id).maybeSingle(),
    ]);

    // Parse alliance
    const alliance = maybeSingleResult<AllianceRow>(allianceRes).data;
    if (alliance) {
      allianceData = { id: alliance.id, name: alliance.name, tag: alliance.tag, inviteCode: alliance.invite_code, memberCount: alliance.member_count };
    }

    // Parse members
    const memberRows = listResult<RawMemberRow>(membersRes).data ?? [];
    const playerIds  = memberRows.map((m) => m.player_id);

    // Parse beacons
    const rawBeaconsData = listResult<RawBeaconRow>(beaconsRes).data ?? [];
    activeBeaconCount = rawBeaconsData.length;
    const catalog = getAllCatalogEntries();
    const systemNameMap = new Map(catalog.map((e) => [e.id, e.properName ?? e.id]));
    beacons = rawBeaconsData.map((b) => ({
      id: b.id, systemId: b.system_id, systemName: systemNameMap.get(b.system_id) ?? b.system_id, placedAt: b.placed_at,
    }));

    // Parse goals + storage
    goals = ((goalsRes.data ?? []) as RawGoalRow[]).map((g) => ({
      id: g.id, title: g.title, resourceType: g.resource_type, quantityTarget: g.quantity_target,
      quantityFilled: g.quantity_filled, creditReward: g.credit_reward, deadlineAt: g.deadline_at, completedAt: g.completed_at,
    }));
    storage = ((storageRes.data ?? []) as RawStorageRow[]).map((r) => ({ resourceType: r.resource_type, quantity: r.quantity }));

    // Parse station ID
    const stationId = maybeSingleResult<{ id: string }>(stationRes).data?.id ?? null;

    // ── Batch 2: handle lookup + station inventory (parallel) ─────────────
    const [handleRes, stationInvRes] = await Promise.all([
      playerIds.length > 0
        ? admin.from("players").select("id, handle").in("id", playerIds)
        : Promise.resolve({ data: [] }),
      stationId
        ? admin.from("resource_inventory").select("resource_type, quantity").eq("location_type", "station").eq("location_id", stationId).order("quantity", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    type HandleRow = { id: string; handle: string };
    const handleMap = new Map<string, string>();
    for (const h of (listResult<HandleRow>(handleRes).data ?? [])) handleMap.set(h.id, h.handle);

    members = memberRows.map((m) => ({
      id: m.id, playerId: m.player_id, handle: handleMap.get(m.player_id) ?? "Unknown", role: m.role, allianceCredits: m.alliance_credits,
    }));

    stationInventory = ((stationInvRes.data ?? []) as RawStorageRow[]).map((r) => ({ resourceType: r.resource_type, quantity: r.quantity }));

    playerAllianceCredits = members.find((m) => m.playerId === player.id)?.allianceCredits ?? 0;
  }

  // ── Fetch disputes involving this alliance ────────────────────────────────
  type DisputePanelRow = {
    id: string;
    beacon_id: string;
    defending_alliance_id: string;
    attacking_alliance_id: string;
    status: string;
    opened_at: string;
    resolves_at: string;
    resolved_at: string | null;
    winner_alliance_id: string | null;
  };
  type DisputePanelEntry = {
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
    isDefender: boolean;
    msLeft: number;
    defenderScore: number;
    attackerScore: number;
    defenderFleetCount: number;
    attackerFleetCount: number;
  };

  let allianceDisputes: DisputePanelEntry[] = [];

  // ── Catalog systems (synchronous, in-memory) ──────────────────────────────
  const catalog = getAllCatalogEntries();
  const catalogSystems = catalog.map((e) => ({ id: e.id, name: e.properName ?? e.id }));

  // ── Compute territory (synchronous) ──────────────────────────────────────
  let hasValidTerritory = false;
  let territorySystems: string[] = [];
  let linkCount = 0;

  if (membership && beacons.length > 0 && allianceData) {
    const catalogBySystem = new Map(catalog.map((e) => [e.id, { x: e.x, y: e.y }]));
    const allSystems      = catalog.map((e) => ({ systemId: e.id, x: e.x, y: e.y }));

    const territoryResults = computeAllTerritories({
      beacons: beacons.map((b) => ({ id: b.id, allianceId: membership.alliance_id, systemId: b.systemId })),
      alliances: new Map([[membership.alliance_id, { name: allianceData.name, tag: allianceData.tag }]]),
      catalogBySystem,
      allSystems,
      maxLinkDist: BALANCE.alliance.beaconLinkMaxDistanceLy,
    });

    const result = territoryResults[0];
    if (result) {
      hasValidTerritory = result.hasValidTerritory;
      territorySystems  = result.systemsInTerritory;
      linkCount         = result.links.length;
    }
  }

  // ── Disputes + fleets (parallel) ─────────────────────────────────────────
  type FleetRow = { id: string; name: string; current_system_id: string | null };
  const [disputesRes, fleetRes] = await Promise.all([
    membership
      ? admin
          .from("disputes")
          .select("id, beacon_id, defending_alliance_id, attacking_alliance_id, status, opened_at, resolves_at, resolved_at, winner_alliance_id")
          .or(`defending_alliance_id.eq.${membership.alliance_id},attacking_alliance_id.eq.${membership.alliance_id}`)
          .order("opened_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    admin
      .from("fleets")
      .select("id, name, current_system_id")
      .eq("player_id", player.id)
      .eq("status", "active")
      .is("dispute_commit_id", null)
      .order("created_at", { ascending: true }),
  ]);

  if (membership) {
    const rawDisputes = listResult<DisputePanelRow>(disputesRes).data ?? [];

    // Enrich disputes with beacon system IDs
    const disputeBeaconIds = [...new Set(rawDisputes.map((d) => d.beacon_id))];
    const disputeIds = rawDisputes.map((d) => d.id);

    type BeaconSysRow = { id: string; system_id: string };
    type ReinfRow = { dispute_id: string; alliance_id: string; score_snapshot: number };

    const [bRowsRes, reinforcementsRes] = await Promise.all([
      disputeBeaconIds.length > 0
        ? admin.from("alliance_beacons").select("id, system_id").in("id", disputeBeaconIds)
        : Promise.resolve({ data: [] }),
      disputeIds.length > 0
        ? admin.from("dispute_reinforcements").select("dispute_id, alliance_id, score_snapshot").in("dispute_id", disputeIds)
        : Promise.resolve({ data: [] }),
    ]);

    const beaconSysMap = new Map<string, string>();
    for (const b of (listResult<BeaconSysRow>(bRowsRes).data ?? [])) {
      beaconSysMap.set(b.id, b.system_id);
    }

    // Aggregate reinforcement scores per dispute per side
    type ScoreEntry = { score: number; fleetCount: number };
    const reinforcementScores = new Map<string, { defending: ScoreEntry; attacking: ScoreEntry }>();
    for (const r of ((reinforcementsRes.data ?? []) as ReinfRow[])) {
      const existing = reinforcementScores.get(r.dispute_id) ?? {
        defending: { score: 0, fleetCount: 0 },
        attacking: { score: 0, fleetCount: 0 },
      };
      // We'll resolve which side is which when building the entry
      const entry = reinforcementScores.get(r.dispute_id);
      if (entry) {
        if (r.alliance_id === rawDisputes.find((d) => d.id === r.dispute_id)?.defending_alliance_id) {
          entry.defending.score += r.score_snapshot;
          entry.defending.fleetCount += 1;
        } else {
          entry.attacking.score += r.score_snapshot;
          entry.attacking.fleetCount += 1;
        }
      } else {
        const d = rawDisputes.find((dd) => dd.id === r.dispute_id);
        const isDefender = d?.defending_alliance_id === r.alliance_id;
        reinforcementScores.set(r.dispute_id, {
          defending: isDefender ? { score: r.score_snapshot, fleetCount: 1 } : { score: 0, fleetCount: 0 },
          attacking: !isDefender ? { score: r.score_snapshot, fleetCount: 1 } : { score: 0, fleetCount: 0 },
        });
      }
    }

    const sysNameMapLocal = new Map(catalog.map((e) => [e.id, e.properName ?? e.id]));

    allianceDisputes = rawDisputes.map((d) => {
      const sysId = beaconSysMap.get(d.beacon_id) ?? "";
      const scores = reinforcementScores.get(d.id) ?? {
        defending: { score: 0, fleetCount: 0 },
        attacking: { score: 0, fleetCount: 0 },
      };
      return {
        id:                  d.id,
        beaconId:            d.beacon_id,
        beaconSystemId:      sysId,
        beaconSystemName:    sysNameMapLocal.get(sysId) ?? sysId,
        defendingAllianceId: d.defending_alliance_id,
        attackingAllianceId: d.attacking_alliance_id,
        status:              d.status,
        openedAt:            d.opened_at,
        resolvesAt:          d.resolves_at,
        resolvedAt:          d.resolved_at,
        winnerAllianceId:    d.winner_alliance_id,
        isDefender:          d.defending_alliance_id === membership.alliance_id,
        msLeft:              Math.max(0, new Date(d.resolves_at).getTime() - pageNow.getTime()),
        defenderScore:       scores.defending.score,
        attackerScore:       scores.attacking.score,
        defenderFleetCount:  scores.defending.fleetCount,
        attackerFleetCount:  scores.attacking.fleetCount,
      };
    });
  }

  const fleetSystemNameMap = new Map(catalog.map((e) => [e.id, e.properName ?? e.id]));
  const playerFleets = (listResult<FleetRow>(fleetRes).data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    currentSystemId: f.current_system_id,
    currentSystemName: f.current_system_id ? (fleetSystemNameMap.get(f.current_system_id) ?? f.current_system_id) : null,
  }));

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
          Alliance
        </span>
      </div>

      <AlliancePanel
        alliance={allianceData}
        membership={membership ? { role: membership.role } : null}
        members={members}
        beacons={beacons}
        activeBeaconCount={activeBeaconCount}
        catalogSystems={catalogSystems}
        playerId={player.id}
        territory={{
          hasValidTerritory,
          systemCount: territorySystems.length,
          systemNames: territorySystems.map((id) => {
            const entry = catalog.find((e) => e.id === id);
            return entry?.properName ?? id;
          }),
          linkCount,
        }}
        disputes={allianceDisputes}
        playerFleets={playerFleets}
        goals={goals}
        storage={storage}
        stationInventory={stationInventory}
        playerAllianceCredits={playerAllianceCredits}
      />
    </div>
  );
}
