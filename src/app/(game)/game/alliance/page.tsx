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
  };
  let members: MemberWithHandle[] = [];

  type BeaconRow = { id: string; systemId: string; systemName: string; placedAt: string };
  let beacons: BeaconRow[] = [];
  let activeBeaconCount = 0;

  if (membership) {
    // ── Fetch alliance details ──────────────────────────────────────────────
    type AllianceRow = {
      id: string;
      name: string;
      tag: string;
      invite_code: string;
      member_count: number;
    };
    const { data: alliance } = maybeSingleResult<AllianceRow>(
      await admin
        .from("alliances")
        .select("id, name, tag, invite_code, member_count")
        .eq("id", membership.alliance_id)
        .maybeSingle(),
    );

    if (alliance) {
      allianceData = {
        id: alliance.id,
        name: alliance.name,
        tag: alliance.tag,
        inviteCode: alliance.invite_code,
        memberCount: alliance.member_count,
      };
    }

    // ── Fetch all members with player handles ──────────────────────────────
    type RawMemberRow = { id: string; player_id: string; role: AllianceRole };
    const { data: rawMembers } = listResult<RawMemberRow>(
      await admin
        .from("alliance_members")
        .select("id, player_id, role")
        .eq("alliance_id", membership.alliance_id)
        .order("joined_at", { ascending: true }),
    );

    const memberRows = rawMembers ?? [];
    const playerIds = memberRows.map((m) => m.player_id);

    type HandleRow = { id: string; handle: string };
    let handleMap = new Map<string, string>();
    if (playerIds.length > 0) {
      const { data: handleRows } = listResult<HandleRow>(
        await admin.from("players").select("id, handle").in("id", playerIds),
      );
      for (const h of handleRows ?? []) handleMap.set(h.id, h.handle);
    }

    members = memberRows.map((m) => ({
      id: m.id,
      playerId: m.player_id,
      handle: handleMap.get(m.player_id) ?? "Unknown",
      role: m.role,
    }));

    // ── Fetch active beacons ───────────────────────────────────────────────
    type RawBeaconRow = { id: string; system_id: string; placed_at: string };
    const { data: rawBeacons } = listResult<RawBeaconRow>(
      await admin
        .from("alliance_beacons")
        .select("id, system_id, placed_at")
        .eq("alliance_id", membership.alliance_id)
        .eq("is_active", true)
        .order("placed_at", { ascending: true }),
    );

    activeBeaconCount = rawBeacons?.length ?? 0;

    // Enrich with system names from catalog
    const catalog = getAllCatalogEntries();
    const systemNameMap = new Map(catalog.map((e) => [e.id, e.properName ?? e.id]));

    beacons = (rawBeacons ?? []).map((b) => ({
      id: b.id,
      systemId: b.system_id,
      systemName: systemNameMap.get(b.system_id) ?? b.system_id,
      placedAt: b.placed_at,
    }));
  }

  // ── Catalog systems for beacon placement selector ─────────────────────────
  const catalog = getAllCatalogEntries();
  const catalogSystems = catalog.map((e) => ({
    id: e.id,
    name: e.properName ?? e.id,
  }));

  // ── Compute territory for this alliance (if any) ──────────────────────────
  let hasValidTerritory = false;
  let territorySystems: string[] = [];
  let linkCount = 0;

  if (membership && beacons.length > 0 && allianceData) {
    const catalogBySystem = new Map(catalog.map((e) => [e.id, { x: e.x, y: e.y }]));
    const allSystems      = catalog.map((e) => ({ systemId: e.id, x: e.x, y: e.y }));

    const territoryResults = computeAllTerritories({
      beacons: beacons.map((b) => ({
        id: b.id,
        allianceId: membership.alliance_id,
        systemId: b.systemId,
      })),
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

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/game/command"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← Command
        </Link>
        <h1 className="text-lg font-semibold text-zinc-100">Alliance</h1>
        {allianceData && (
          <span className="font-mono text-xs text-indigo-400 bg-indigo-950/60 border border-indigo-800/50 px-1.5 py-0.5 rounded">
            [{allianceData.tag}]
          </span>
        )}
      </div>

      {!allianceData && (
        <p className="text-sm text-zinc-500">
          You are not currently in an alliance. Found one or use an invite code to join.
        </p>
      )}

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
      />
    </div>
  );
}
