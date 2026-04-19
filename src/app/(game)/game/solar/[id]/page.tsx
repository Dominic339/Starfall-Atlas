/**
 * /game/solar/[id] — Interactive Solar System Hub
 *
 * Server component that fetches all player-relevant data for this system,
 * then renders the SystemHubClient which manages the 3D scene + action panels.
 *
 * This is the primary system view. Navigation from the galaxy map lands here.
 *
 * Layout:
 *   - Thin top nav bar (breadcrumb, system name)
 *   - SystemHubClient (fills rest): 3D canvas + context-sensitive sidebar
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry, systemDisplayName } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import { HARSH_PLANET_TYPES } from "@/lib/game/habitability";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";
import { BALANCE } from "@/lib/config/balance";
import type { Player } from "@/lib/types/game";
import type { SolarSceneSystemData } from "./_components/SolarScene";
import type { BodyInfo, ShipInfo, FleetInfo, OtherColonyInfo, GovernanceInfo } from "./_components/SystemHubClient";
import { SystemHubClient } from "./_components/SystemHubClient";
import { runEngineTick } from "@/lib/game/engineTick";
import { runTravelResolution } from "@/lib/game/travelResolution";
import { refreshInfluenceCache, checkContestedRevert } from "@/lib/game/influence";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const name = systemDisplayName(decodeURIComponent(id));
  return { title: `${name} — Starfall Atlas` };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SolarSystemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const systemId = decodeURIComponent(rawId);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const user = await getUser();
  if (!user) redirect("/login");

  // ── Catalog ───────────────────────────────────────────────────────────────
  const catalogEntry = getCatalogEntry(systemId);
  if (!catalogEntry) notFound();

  const system = generateSystem(systemId, catalogEntry);
  const isSol  = systemId === SOL_SYSTEM_ID;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin
      .from("players")
      .select("id, handle, credits, first_colony_placed, colony_slots")
      .eq("auth_id", user.id)
      .maybeSingle(),
  );
  if (!player) redirect("/login");

  // ── Engine tick + travel resolution + influence refresh (lazy) ───────────
  const requestTime = new Date();
  await Promise.all([
    runEngineTick(admin, player.id, requestTime),
    runTravelResolution(admin, player.id, requestTime),
    refreshInfluenceCache(admin, systemId).catch(() => undefined),
    checkContestedRevert(admin, systemId).catch(() => undefined),
  ]);

  // ── Parallel fetches ─────────────────────────────────────────────────────
  const [
    shipsRes, fleetsRes, coloniesRes,
    stationRes, discoveryRes,
    surveyRes, playerColoniesRes, researchRes,
    allSystemColoniesRes, stewardshipRes,
    systemStewardshipRes, gateRes, lanesRes,
    influenceCacheRes, majorityControlRes,
  ] = await Promise.all([
    // Ships in this system (full data)
    admin
      .from("ships")
      .select("id, name, dispatch_mode, cargo_cap, speed_ly_per_hr, ship_state")
      .eq("owner_id", player.id)
      .eq("current_system_id", systemId),

    // Fleets in this system
    admin
      .from("fleets")
      .select("id, name, status")
      .eq("player_id", player.id)
      .eq("current_system_id", systemId)
      .neq("status", "disbanded"),

    // Player's active colonies in this system
    admin
      .from("colonies")
      .select("id, body_id, status, population_tier")
      .eq("owner_id", player.id)
      .eq("system_id", systemId)
      .eq("status", "active"),

    // Station location
    admin
      .from("player_stations")
      .select("id, current_system_id")
      .eq("owner_id", player.id)
      .maybeSingle(),

    // Discovery record
    admin
      .from("system_discoveries")
      .select("system_id, is_first")
      .eq("player_id", player.id)
      .eq("system_id", systemId)
      .maybeSingle(),

    // Survey results for all bodies in this system
    admin
      .from("survey_results")
      .select("body_id")
      .eq("system_id", systemId),

    // Player's total active colony count (for first-colony detection)
    admin
      .from("colonies")
      .select("id")
      .eq("owner_id", player.id)
      .eq("status", "active"),

    // Research unlocks (for harsh-colony gating)
    admin
      .from("player_research")
      .select("research_id")
      .eq("player_id", player.id),

    // All active colonies in this system (any player) — for multiplayer visibility
    admin
      .from("colonies")
      .select("id, body_id, owner_id, population_tier")
      .eq("system_id", systemId)
      .eq("status", "active"),

    // Body stewardship records in this system (includes default permit tax rate)
    admin
      .from("body_stewardship")
      .select("body_id, steward_id, default_tax_rate_pct")
      .eq("system_id", systemId),

    // System-level stewardship (for governance/gate eligibility)
    admin
      .from("system_stewardship")
      .select("steward_id, has_governance")
      .eq("system_id", systemId)
      .maybeSingle(),

    // Hyperspace gate for this system (if any)
    admin
      .from("hyperspace_gates")
      .select("id, status, built_at")
      .eq("system_id", systemId)
      .maybeSingle(),

    // Active lanes connected to this system
    admin
      .from("hyperspace_lanes")
      .select("id, from_system_id, to_system_id, owner_id, access_level, transit_tax_rate, is_active")
      .eq("is_active", true)
      .or(`from_system_id.eq.${systemId},to_system_id.eq.${systemId}`),

    // Influence cache for this system (freshly computed above)
    admin
      .from("system_influence_cache")
      .select("player_id, influence, colony_count")
      .eq("system_id", systemId),

    // Majority control record for this system
    admin
      .from("system_majority_control")
      .select("controller_id, alliance_id, influence_share, is_confirmed, control_since")
      .eq("system_id", systemId)
      .maybeSingle(),
  ]);

  type ShipRow    = { id: string; name: string; dispatch_mode: string; cargo_cap: number; speed_ly_per_hr: number; ship_state: string };
  type FleetRow   = { id: string; name: string; status: string };
  type ColonyRow  = { id: string; body_id: string; status: string; population_tier: number };
  type SurveyRow  = { body_id: string };
  type ResearchRow = { research_id: string };
  type AllColonyRow = { id: string; body_id: string; owner_id: string; population_tier: number };
  type StewardRow = { body_id: string; steward_id: string; default_tax_rate_pct: number };
  type LaneRow = { id: string; from_system_id: string; to_system_id: string; owner_id: string; access_level: string; transit_tax_rate: number; is_active: boolean };
  type InfluenceCacheRow = { player_id: string; influence: number; colony_count: number };
  type MajorityControlRow = { controller_id: string; alliance_id: string | null; influence_share: number; is_confirmed: boolean; control_since: string };

  const ships       = (shipsRes.data   ?? []) as ShipRow[];
  const fleets      = (fleetsRes.data  ?? []) as FleetRow[];
  const colonies    = (coloniesRes.data ?? []) as ColonyRow[];
  const stationData = stationRes.data as { id: string; current_system_id: string } | null;
  const stationHere = stationData?.current_system_id === systemId;
  const stationId   = stationData?.id ?? null;
  const isDiscovered = !!(discoveryRes.data) || isSol;
  const surveyedBodyIds = new Set<string>(
    listResult<SurveyRow>(surveyRes).data?.map(s => s.body_id) ?? [],
  );
  const activeColonyCount = listResult<{ id: string }>(playerColoniesRes).data?.length ?? 0;
  const hasHarshResearch  = listResult<ResearchRow>(researchRes).data?.some(
    r => r.research_id === "harsh_colony_environment",
  ) ?? false;

  // All colonies in this system (any player)
  const allSystemColonies = listResult<AllColonyRow>(allSystemColoniesRes).data ?? [];
  const stewardshipRows   = listResult<StewardRow>(stewardshipRes).data ?? [];

  // System-level governance
  const systemStewardRow = systemStewardshipRes.data as { steward_id: string; has_governance: boolean } | null;
  const isSystemGovernor = !!(systemStewardRow && systemStewardRow.steward_id === player.id && systemStewardRow.has_governance);

  // Gate for this system
  type GateRow = { id: string; status: string; built_at: string | null };
  const gateRow = gateRes.data as GateRow | null;
  type GateInfo = { status: "none" | "inactive" | "active" | "neutral"; completeAt: string | null };

  // Fetch pending gate construction job if gate is inactive
  let gateInfo: GateInfo = { status: "none", completeAt: null };
  if (gateRow) {
    let completeAt: string | null = null;
    if (gateRow.status === "inactive" || gateRow.status === "neutral") {
      const { data: jobRow } = await admin
        .from("gate_construction_jobs")
        .select("complete_at")
        .eq("gate_id", gateRow.id)
        .eq("status", "pending")
        .maybeSingle();
      completeAt = (jobRow as { complete_at: string } | null)?.complete_at ?? null;
    }
    gateInfo = { status: gateRow.status as GateInfo["status"], completeAt };
  }

  // Active lanes connected to this system
  const activeLaneRows = listResult<LaneRow>(lanesRes).data ?? [];
  // Resolve system names for lane endpoints
  const { getCatalogEntry: _getCE, systemDisplayName: getDisplayName } = await import("@/lib/catalog");
  type LaneInfo = { id: string; remoteSystemId: string; remoteSystemName: string; ownerId: string; isOwner: boolean; accessLevel: string; transitTaxRate: number };
  const activeLanes: LaneInfo[] = activeLaneRows.map(l => {
    const remoteId = l.from_system_id === systemId ? l.to_system_id : l.from_system_id;
    return {
      id:               l.id,
      remoteSystemId:   remoteId,
      remoteSystemName: getDisplayName(remoteId),
      ownerId:          l.owner_id,
      isOwner:          l.owner_id === player.id,
      accessLevel:      l.access_level,
      transitTaxRate:   l.transit_tax_rate,
    };
  });

  // ── Build governance info ─────────────────────────────────────────────────
  const influenceCacheRows = listResult<InfluenceCacheRow>(influenceCacheRes).data ?? [];
  const majorityControlRow = majorityControlRes.data as MajorityControlRow | null;

  const totalInfluence = influenceCacheRows.reduce((s, r) => s + r.influence, 0);
  const playerInfluenceRow = influenceCacheRows.find((r) => r.player_id === player.id);
  const playerInfluence    = playerInfluenceRow?.influence ?? 0;
  const playerColonyCount  = playerInfluenceRow?.colony_count ?? 0;

  // Determine if the player (or their alliance) can claim majority now.
  const playerInfluenceShare = totalInfluence > 0 ? playerInfluence / totalInfluence : 0;
  const { BALANCE: _BAL } = await import("@/lib/config/balance");
  const minColonies = _BAL.influence.majorityThresholdMinColonies;

  // Check alliance aggregate if player is in an alliance
  type AMMemberRow = { player_id: string; alliance_id: string };
  const { data: allianceMembersRaw } = await admin
    .from("alliance_members")
    .select("player_id, alliance_id")
    .in("player_id", influenceCacheRows.map((r) => r.player_id));
  const allianceMembersInSystem = (allianceMembersRaw ?? []) as AMMemberRow[];
  const allianceMembershipMap = new Map(allianceMembersInSystem.map((r) => [r.player_id, r.alliance_id]));
  const playerAllianceIdInSystem = allianceMembershipMap.get(player.id) ?? null;

  let canClaimMajority = false;
  if (playerInfluenceShare > 0.5 && playerColonyCount >= minColonies) {
    canClaimMajority = true;
  } else if (playerAllianceIdInSystem) {
    const allianceInfluence = influenceCacheRows
      .filter((r) => allianceMembershipMap.get(r.player_id) === playerAllianceIdInSystem)
      .reduce((s, r) => s + r.influence, 0);
    const allianceColonies = influenceCacheRows
      .filter((r) => allianceMembershipMap.get(r.player_id) === playerAllianceIdInSystem)
      .reduce((s, r) => s + r.colony_count, 0);
    const allianceShare = totalInfluence > 0 ? allianceInfluence / totalInfluence : 0;
    if (allianceShare > 0.5 && allianceColonies >= minColonies) {
      canClaimMajority = true;
    }
  }

  // Resolve handles for steward + majority controller
  const governancePlayerIds = new Set<string>();
  if (systemStewardRow?.steward_id) governancePlayerIds.add(systemStewardRow.steward_id);
  if (majorityControlRow?.controller_id) governancePlayerIds.add(majorityControlRow.controller_id);

  // We'll resolve these handles from ownerHandles below, after that map is built.
  // (ownerHandles is built a few lines down — we do a separate lookup here first.)
  type GovHandleRow = { id: string; handle: string };
  const govHandleRows = governancePlayerIds.size > 0
    ? (listResult<GovHandleRow>(
        await admin.from("players").select("id, handle").in("id", [...governancePlayerIds]),
      ).data ?? [])
    : [];
  const govHandles = new Map(govHandleRows.map((r) => [r.id, r.handle]));

  // Alliance name for majority controller's alliance (if applicable)
  let majorityAllianceName: string | null = null;
  if (majorityControlRow?.alliance_id) {
    const { data: allianceRow } = await admin
      .from("alliances")
      .select("name")
      .eq("id", majorityControlRow.alliance_id)
      .maybeSingle();
    majorityAllianceName = (allianceRow as { name: string } | null)?.name ?? null;
  }

  const governanceInfo: GovernanceInfo = {
    stewardId:            systemStewardRow?.steward_id ?? null,
    stewardHandle:        systemStewardRow?.steward_id ? (govHandles.get(systemStewardRow.steward_id) ?? null) : null,
    stewardHasGovernance: systemStewardRow?.has_governance ?? true,
    majorityControl: majorityControlRow
      ? {
          controllerId:     majorityControlRow.controller_id,
          controllerHandle: govHandles.get(majorityControlRow.controller_id) ?? "Unknown",
          allianceId:       majorityControlRow.alliance_id,
          allianceName:     majorityAllianceName,
          influenceShare:   majorityControlRow.influence_share,
          isConfirmed:      majorityControlRow.is_confirmed,
          controlSince:     majorityControlRow.control_since,
        }
      : null,
    playerInfluence,
    totalInfluence,
    playerColonyCount,
    canClaimMajority,
  };

  // Resolve handles for other colony owners
  const otherOwnerIds = [...new Set(
    allSystemColonies.filter(c => c.owner_id !== player.id).map(c => c.owner_id),
  )];
  const ownerHandles = new Map<string, string>([[player.id, player.handle]]);
  if (otherOwnerIds.length > 0) {
    type HandleRow = { id: string; handle: string };
    const { data: handleRows } = listResult<HandleRow>(
      await admin.from("players").select("id, handle").in("id", otherOwnerIds),
    );
    for (const h of handleRows ?? []) ownerHandles.set(h.id, h.handle);
  }

  // Map: bodyId → full steward row (steward_id + default_tax_rate_pct)
  const stewardByBodyId = new Map(stewardshipRows.map(s => [s.body_id, s]));

  // Build other players' colony info for the scene
  const otherColonies: OtherColonyInfo[] = allSystemColonies
    .filter(c => c.owner_id !== player.id)
    .map(c => {
      const parts = c.body_id.split(":");
      const idx   = parseInt(parts[parts.length - 1], 10);
      return {
        bodyIndex:      idx,
        bodyId:         c.body_id,
        ownerHandle:    ownerHandles.get(c.owner_id) ?? "Unknown",
        populationTier: c.population_tier,
      };
    })
    .filter(c => !isNaN(c.bodyIndex));

  const isFirstColony = !player.first_colony_placed && activeColonyCount === 0;
  const atSlotCap     =
    player.colony_slots < BALANCE.colony.slotsUnlimited &&
    activeColonyCount >= player.colony_slots;

  // Colony lookup by body index
  const colonyByBodyIdx = new Map<number, ColonyRow>();
  const coloniesBodyIndices: number[] = [];
  for (const colony of colonies) {
    const parts = colony.body_id.split(":");
    const idx   = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(idx)) {
      coloniesBodyIndices.push(idx);
      colonyByBodyIdx.set(idx, colony);
    }
  }

  // Presence flags
  const shipPresentHere    = ships.length > 0;
  const hasSystemAccess    = isSol || isDiscovered;
  const canActOnBodies     = shipPresentHere && hasSystemAccess;
  // Survey / discover also allowed when station is present (no ship required)
  const canSurveyBodies    = (shipPresentHere || stationHere) && hasSystemAccess;
  const canDiscover        = (shipPresentHere || stationHere) && !isDiscovered && !isSol;

  // ── Build per-body info ───────────────────────────────────────────────────

  const bodies: BodyInfo[] = system.bodies.map((body, i) => {
    const bodyId = `${systemId}:${i}`;
    const colony = colonyByBodyIdx.get(i) ?? null;

    // Colonisability: use the precomputed canHostColony flag from generation.
    // Harsh types (volcanic, toxic) need research — server will gate properly.
    const isHarsh = HARSH_PLANET_TYPES.has(body.type as never);
    const isColonisable =
      colony === null &&
      !atSlotCap &&
      canActOnBodies &&
      (body.canHostColony || (isHarsh && hasHarshResearch));

    const stewardRow = stewardByBodyId.get(bodyId) ?? null;
    return {
      type:              body.type,
      size:              body.size,
      bodyId,
      colonyId:          colony?.id ?? null,
      populationTier:    colony?.population_tier ?? null,
      isSurveyed:        surveyedBodyIds.has(bodyId),
      isColonisable,
      stewardHandle:     stewardRow ? (ownerHandles.get(stewardRow.steward_id) ?? null) : null,
      isPlayerSteward:   stewardRow?.steward_id === player.id,
      defaultTaxRatePct: stewardRow?.default_tax_rate_pct ?? 0,
    };
  });

  // ── Build scene data ──────────────────────────────────────────────────────

  const sceneSystem: SolarSceneSystemData = {
    name:          system.name,
    spectralClass: system.spectralClass,
    bodies: system.bodies.map(b => ({ type: b.type, size: b.size })),
  };

  const sceneShips: ShipInfo[] = ships.map(s => ({
    id:              s.id,
    name:            s.name,
    dispatch_mode:   s.dispatch_mode,
    cargo_cap:       Number(s.cargo_cap),
    speed_ly_per_hr: Number(s.speed_ly_per_hr),
    ship_state:      s.ship_state ?? "idle_in_system",
  }));

  const sceneFleets: FleetInfo[] = fleets.map(f => ({
    id:     f.id,
    name:   f.name,
    status: f.status,
  }));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#06060a]">

      {/* Top nav bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800/60 bg-zinc-950 px-4 py-2 text-xs">
        <Link
          href="/game/map"
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← Galaxy Map
        </Link>
        <span className="text-zinc-800">/</span>
        <span className="text-zinc-400 font-medium">{system.name}</span>
        <span className="text-zinc-700">{system.spectralClass}-class</span>
        {isSol && (
          <span className="text-amber-600">Home System</span>
        )}
        {isDiscovered && !isSol && (
          <span className="text-emerald-700">Discovered</span>
        )}
        {shipPresentHere && (
          <span className="text-indigo-600">
            {ships.length > 1 ? `${ships.length} ships` : "Ship present"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-4">
          {stationHere && (
            <Link href="/game/station" className="text-amber-600 hover:text-amber-400 transition-colors">
              Station →
            </Link>
          )}
          <Link
            href={`/game/system/${encodeURIComponent(systemId)}`}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            System detail →
          </Link>
        </div>
      </div>

      {/* Hub (3D scene + sidebar) */}
      <SystemHubClient
        systemId={systemId}
        system={sceneSystem}
        bodies={bodies}
        ships={sceneShips}
        fleets={sceneFleets}
        coloniesBodyIndices={coloniesBodyIndices}
        stationHere={stationHere}
        stationId={stationId}
        isDiscovered={isDiscovered}
        canActOnBodies={canActOnBodies}
        canSurveyBodies={canSurveyBodies}
        canDiscover={canDiscover}
        isFirstColony={isFirstColony}
        spectralClass={system.spectralClass}
        bodyCount={system.bodyCount}
        otherColonies={otherColonies}
        isSystemGovernor={isSystemGovernor}
        gateInfo={gateInfo}
        activeLanes={activeLanes}
        governanceInfo={governanceInfo}
      />
    </div>
  );
}
