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
import type { BodyInfo, ShipInfo, FleetInfo, OtherColonyInfo } from "./_components/SystemHubClient";
import { SystemHubClient } from "./_components/SystemHubClient";
import { runEngineTick } from "@/lib/game/engineTick";
import { runTravelResolution } from "@/lib/game/travelResolution";

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

  // ── Engine tick + travel resolution (lazy) ────────────────────────────────
  const requestTime = new Date();
  await Promise.all([
    runEngineTick(admin, player.id, requestTime),
    runTravelResolution(admin, player.id, requestTime),
  ]);

  // ── Parallel fetches ─────────────────────────────────────────────────────
  const [
    shipsRes, fleetsRes, coloniesRes,
    stationRes, discoveryRes,
    surveyRes, playerColoniesRes, researchRes,
    allSystemColoniesRes, stewardshipRes,
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

    // Body stewardship records in this system
    admin
      .from("body_stewardship")
      .select("body_id, steward_id")
      .eq("system_id", systemId),
  ]);

  type ShipRow    = { id: string; name: string; dispatch_mode: string; cargo_cap: number; speed_ly_per_hr: number; ship_state: string };
  type FleetRow   = { id: string; name: string; status: string };
  type ColonyRow  = { id: string; body_id: string; status: string; population_tier: number };
  type SurveyRow  = { body_id: string };
  type ResearchRow = { research_id: string };
  type AllColonyRow = { id: string; body_id: string; owner_id: string; population_tier: number };
  type StewardRow = { body_id: string; steward_id: string };

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

  // Map: bodyId → steward_id
  const stewardByBodyId = new Map(stewardshipRows.map(s => [s.body_id, s.steward_id]));

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

  // Ship present? (for action eligibility — slot cap only blocks founding, not taxes/extraction)
  const shipPresentHere = ships.length > 0;
  const hasSystemAccess = isSol || isDiscovered;
  const canActOnBodies  = shipPresentHere && hasSystemAccess;

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

    const stewardId = stewardByBodyId.get(bodyId) ?? null;
    return {
      type:              body.type,
      size:              body.size,
      bodyId,
      colonyId:          colony?.id ?? null,
      populationTier:    colony?.population_tier ?? null,
      isSurveyed:        surveyedBodyIds.has(bodyId),
      isColonisable,
      stewardHandle:     stewardId ? (ownerHandles.get(stewardId) ?? null) : null,
      isPlayerSteward:   stewardId === player.id,
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
        isFirstColony={isFirstColony}
        spectralClass={system.spectralClass}
        bodyCount={system.bodyCount}
        otherColonies={otherColonies}
      />
    </div>
  );
}
