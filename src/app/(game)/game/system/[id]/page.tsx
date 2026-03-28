/**
 * System detail page — /game/system/[id]
 *
 * Read-only view of a star system for Phase 4/5.
 * Shows: name, star class, generated bodies, discovery status, stewardship.
 *
 * Phase 4 actions: Travel here, Discover (if present and undiscovered), Arrive.
 * Phase 5 additions per body: Survey, Found Colony (when eligible and conditions met).
 *
 * Sol is handled as a special case: no discovery, no steward, canonical start.
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry, getNearbySystems, systemDisplayName } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import { isHarshPlanetType } from "@/lib/game/habitability";
import { distanceBetween } from "@/lib/game/travel";
import { BALANCE } from "@/lib/config/balance";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";
import type {
  Ship,
  Player,
  SystemDiscovery,
  SystemStewardship,
  TravelJob,
  SurveyResult,
  Colony,
  ResourceInventoryRow,
} from "@/lib/types/game";
import {
  TravelButton,
  DiscoverButton,
  ArriveButton,
  SurveyButton,
  FoundColonyButton,
  LoadButton,
} from "./_components/SystemActions";
import { CreateRouteForm, DeleteRouteButton } from "./_components/RouteControls";
import { TransportPanel } from "./_components/TransportControls";
import type { ColonyRoute, ColonyTransport } from "@/lib/types/game";

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

export default async function SystemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const systemId = decodeURIComponent(rawId);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const user = await getUser();
  if (!user) redirect("/login");

  // ── Catalog lookup ────────────────────────────────────────────────────────
  const catalogEntry = getCatalogEntry(systemId);
  if (!catalogEntry) notFound();

  // ── Generate system data (deterministic, no DB) ───────────────────────────
  const system = generateSystem(systemId, catalogEntry);
  const isSol = systemId === SOL_SYSTEM_ID;

  const admin = createAdminClient();

  // ── Fetch current player and ship ─────────────────────────────────────────
  const { data: player } = maybeSingleResult<Player>(
    await admin
      .from("players")
      .select("id, handle, credits, first_colony_placed, colony_slots")
      .eq("auth_id", user.id)
      .maybeSingle(),
  );

  if (!player) redirect("/login");

  // Phase 16: fetch player research to check harsh colony gating.
  const { data: researchData } = listResult<{ research_id: string }>(
    await admin
      .from("player_research")
      .select("research_id")
      .eq("player_id", player.id),
  );
  const hasHarshColonyResearch = (researchData ?? []).some(
    (r) => r.research_id === "harsh_colony_environment",
  );

  // Fetch all ships — players start with 2 (Phase 5.5).
  const { data: shipsData } = listResult<Ship>(
    await admin
      .from("ships")
      .select("*")
      .eq("owner_id", player.id)
      .order("created_at", { ascending: true }),
  );
  const shipList = shipsData ?? [];

  // ── Fetch pending travel job (in transit?) ────────────────────────────────
  const { data: pendingJobs } = listResult<TravelJob>(
    await admin
      .from("travel_jobs")
      .select("*")
      .eq("player_id", player.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1),
  );
  const activeTravelJob = pendingJobs?.[0] ?? null;

  // Is any ship currently in transit TO this system?
  const inTransitHere =
    !!activeTravelJob &&
    activeTravelJob.to_system_id === systemId &&
    shipList.some(
      (s) => !s.current_system_id && s.id === activeTravelJob.ship_id,
    );

  // Is any ship currently docked AT this system?
  const shipPresentHere = shipList.find((s) => s.current_system_id === systemId) ?? null;
  const shipIsHere = !!shipPresentHere;

  // ── Discovery / stewardship state ─────────────────────────────────────────
  const { data: myDiscovery } = maybeSingleResult<SystemDiscovery>(
    await admin
      .from("system_discoveries")
      .select("*")
      .eq("system_id", systemId)
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  const { data: stewardship } = maybeSingleResult<SystemStewardship>(
    await admin
      .from("system_stewardship")
      .select("*")
      .eq("system_id", systemId)
      .maybeSingle(),
  );

  // Fetch steward's handle if stewardship exists.
  let stewardHandle: string | null = null;
  if (stewardship) {
    const { data: stewardPlayer } = maybeSingleResult<{ handle: string }>(
      await admin
        .from("players")
        .select("handle")
        .eq("id", stewardship.steward_id)
        .maybeSingle(),
    );
    stewardHandle = stewardPlayer?.handle ?? null;
  }

  // ── Travel reachability ───────────────────────────────────────────────────
  // Find a ship that is docked somewhere other than this system and not the
  // ship currently in an active travel job. This is the ship that would be
  // dispatched by POST /api/game/travel (first docked ship).
  const travelingShipId = activeTravelJob?.ship_id ?? null;
  const travelableShip =
    !activeTravelJob
      ? (shipList.find(
          (s) =>
            s.current_system_id != null &&
            s.current_system_id !== systemId,
        ) ?? null)
      : (shipList.find(
          (s) =>
            s.current_system_id != null &&
            s.current_system_id !== systemId &&
            s.id !== travelingShipId,
        ) ?? null);

  const maxRangeLy = BALANCE.lanes.baseRangeLy;
  let travelDistance: number | null = null;
  let canTravelHere = false;

  if (travelableShip?.current_system_id) {
    const fromEntry = getCatalogEntry(travelableShip.current_system_id);
    if (fromEntry) {
      travelDistance = distanceBetween(
        { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
        { x: catalogEntry.x, y: catalogEntry.y, z: catalogEntry.z },
      );
      canTravelHere = travelDistance <= maxRangeLy;
    }
  }

  // Guard: speed_ly_per_hr is a NUMERIC column; Supabase may return it as a string.
  const travelHours =
    travelableShip && travelDistance !== null
      ? travelDistance / Number(travelableShip.speed_ly_per_hr)
      : null;

  // ── Nearby systems from this system ───────────────────────────────────────
  const nearbySystems = isSol
    ? getNearbySystems(systemId, maxRangeLy)
    : getNearbySystems(systemId, maxRangeLy).slice(0, 6);

  // ── Phase 5: Survey results for all bodies in this system ─────────────────
  const { data: surveyResults } = listResult<SurveyResult>(
    await admin
      .from("survey_results")
      .select("*")
      .eq("system_id", systemId),
  );
  const surveyByBodyId = new Map(
    (surveyResults ?? []).map((s) => [s.body_id, s]),
  );

  // ── Phase 5/6: Colonies in this system (any player) ──────────────────────
  type ColonyRow = Pick<
    Colony,
    "id" | "body_id" | "owner_id" | "status" | "population_tier" | "next_growth_at"
  >;
  const { data: systemColonies } = listResult<ColonyRow>(
    await admin
      .from("colonies")
      .select("id, body_id, owner_id, status, population_tier, next_growth_at")
      .eq("system_id", systemId),
  );
  const colonyByBodyId = new Map(
    (systemColonies ?? []).map((c) => [c.body_id, c]),
  );

  // ── Phase 26: Fetch owner handles for other players' active colonies ───────
  const otherOwnerIds = [
    ...new Set(
      (systemColonies ?? [])
        .filter((c) => c.owner_id !== player.id && c.status !== "collapsed")
        .map((c) => c.owner_id),
    ),
  ];
  const colonyOwnerHandles = new Map<string, string>();
  if (otherOwnerIds.length > 0) {
    const { data: ownerRows } = listResult<{ id: string; handle: string }>(
      await admin
        .from("players")
        .select("id, handle")
        .in("id", otherOwnerIds),
    );
    for (const row of ownerRows ?? []) {
      colonyOwnerHandles.set(row.id, row.handle);
    }
  }

  // ── Phase 26: Fetch first discoverer info for this system ─────────────────
  let firstDiscovererHandle: string | null = null;
  if (!isSol && !myDiscovery?.is_first) {
    const { data: firstDisc } = maybeSingleResult<{ player_id: string }>(
      await admin
        .from("system_discoveries")
        .select("player_id")
        .eq("system_id", systemId)
        .eq("is_first", true)
        .maybeSingle(),
    );
    if (firstDisc) {
      const { data: discPlayer } = maybeSingleResult<{ handle: string }>(
        await admin
          .from("players")
          .select("handle")
          .eq("id", firstDisc.player_id)
          .maybeSingle(),
      );
      firstDiscovererHandle = discPlayer?.handle ?? null;
    }
  }

  // ── Phase 7: Colony inventory for player's colonies in this system ─────────
  // Used to display load actions when a ship is present.
  const myColonyIds = (systemColonies ?? [])
    .filter((c) => c.owner_id === player.id && c.status === "active")
    .map((c) => c.id);

  type InvRow = Pick<ResourceInventoryRow, "resource_type" | "quantity"> & {
    location_id: string;
  };
  const colonyInvRows: InvRow[] =
    myColonyIds.length > 0
      ? (listResult<InvRow>(
          await admin
            .from("resource_inventory")
            .select("location_id, resource_type, quantity")
            .eq("location_type", "colony")
            .in("location_id", myColonyIds)
            .order("resource_type", { ascending: true }),
        ).data ?? [])
      : [];
  const colonyInventoryById = new Map<
    string,
    { resource_type: string; quantity: number }[]
  >();
  for (const row of colonyInvRows) {
    const existing = colonyInventoryById.get(row.location_id) ?? [];
    existing.push({ resource_type: row.resource_type, quantity: row.quantity });
    colonyInventoryById.set(row.location_id, existing);
  }

  // Ship present here for load actions (first docked ship in system)
  const loadingShip = shipList.find((s) => s.current_system_id === systemId) ?? null;

  // ── Phase 15: supply routes and transports for this system's colonies ──────
  // Fetch all player's active colonies (for route destination selector).
  type AllColonyRow = { id: string; body_id: string; system_id: string };
  const { data: allPlayerColonies } = listResult<AllColonyRow>(
    await admin
      .from("colonies")
      .select("id, body_id, system_id")
      .eq("owner_id", player.id)
      .eq("status", "active"),
  );
  const allActiveColonies = allPlayerColonies ?? [];

  // Fetch existing routes for player's colonies in this system.
  type RouteRow = Pick<ColonyRoute,
    "id" | "from_colony_id" | "to_colony_id" | "resource_type" | "mode" | "fixed_amount" | "interval_minutes"
  >;
  const colonyRoutesRows: RouteRow[] =
    myColonyIds.length > 0
      ? (listResult<RouteRow>(
          await admin
            .from("colony_routes")
            .select("id, from_colony_id, to_colony_id, resource_type, mode, fixed_amount, interval_minutes")
            .eq("player_id", player.id)
            .or(`from_colony_id.in.(${myColonyIds.join(",")}),to_colony_id.in.(${myColonyIds.join(",")})`)
            .order("from_colony_id"),
        ).data ?? [])
      : [];

  // Fetch transports for player's colonies in this system.
  type TransportRow = Pick<ColonyTransport, "id" | "colony_id" | "tier">;
  const transportRows: TransportRow[] =
    myColonyIds.length > 0
      ? (listResult<TransportRow>(
          await admin
            .from("colony_transports")
            .select("id, colony_id, tier")
            .in("colony_id", myColonyIds),
        ).data ?? [])
      : [];

  // Build lookup maps.
  const routesByFromColonyId = new Map<string, RouteRow[]>();
  const routesByToColonyId   = new Map<string, RouteRow[]>();
  for (const r of colonyRoutesRows) {
    const fl = routesByFromColonyId.get(r.from_colony_id) ?? [];
    fl.push(r);
    routesByFromColonyId.set(r.from_colony_id, fl);
    const tl = routesByToColonyId.get(r.to_colony_id) ?? [];
    tl.push(r);
    routesByToColonyId.set(r.to_colony_id, tl);
  }
  const transportsByColonyId = new Map<string, TransportRow[]>();
  for (const t of transportRows) {
    const list = transportsByColonyId.get(t.colony_id) ?? [];
    list.push(t);
    transportsByColonyId.set(t.colony_id, list);
  }

  // ── Phase 18: station inventory (for transport purchase/upgrade affordability) ──
  const { data: stationRow } = maybeSingleResult<{ id: string }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("player_stations")
      .select("id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );

  type StationInvRow = { resource_type: string; quantity: number };
  const stationInvRes = stationRow
    ? await admin
        .from("resource_inventory")
        .select("resource_type, quantity")
        .eq("location_type", "station")
        .eq("location_id", stationRow.id)
        .in("resource_type", ["iron", "carbon", "steel"])
    : { data: [] as StationInvRow[], error: null };
  const { data: stationInvRows } = listResult<StationInvRow>(stationInvRes);
  const stationInvMap = new Map((stationInvRows ?? []).map((r) => [r.resource_type, r.quantity]));
  const stationIronForTransports   = stationInvMap.get("iron")   ?? 0;
  const stationCarbonForTransports = stationInvMap.get("carbon") ?? 0;
  const stationSteelForTransports  = stationInvMap.get("steel")  ?? 0;

  // Build destination colony selector options (exclude current colony, already-routed ones per resource).
  const colonyLabelById = new Map<string, string>(
    allActiveColonies.map((c) => [
      c.id,
      `${systemDisplayName(c.system_id)} · Body ${c.body_id.slice(c.body_id.lastIndexOf(":") + 1)}`,
    ]),
  );

  // All resources that could appear in colony inventory (for the form).
  const ALL_RESOURCE_TYPES = [
    "iron", "carbon", "ice", "silica", "water", "biomass", "sulfur", "rare_crystal",
    "food", "steel", "glass",
  ];

  // ── Conditions for per-body actions ──────────────────────────────────────
  // Player can act on bodies if ship is here AND system is accessible.
  // Sol is always accessible (no discovery required).
  const hasSystemAccess = isSol || !!myDiscovery;
  const canActOnBodies = shipIsHere && hasSystemAccess;

  // Count player's active colonies (for first-colony detection display)
  const { data: playerActiveColonies } = listResult<{ id: string }>(
    await admin
      .from("colonies")
      .select("id")
      .eq("owner_id", player.id)
      .eq("status", "active"),
  );
  const activeColonyCount = playerActiveColonies?.length ?? 0;
  const isFirstColony = !player.first_colony_placed && activeColonyCount === 0;
  // True when the player has filled their current slot tier (unlimited tier bypasses this).
  const atSlotCap =
    player.colony_slots < BALANCE.colony.slotsUnlimited &&
    activeColonyCount >= player.colony_slots;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-xs text-zinc-600">
        <Link href="/game/command" className="hover:text-zinc-400">
          Command Centre
        </Link>
        {" › "}
        <span className="text-zinc-400">{system.name}</span>
      </nav>

      {/* System header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-zinc-50">
              {system.name}
            </h1>
            {isSol && (
              <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-xs font-medium text-amber-300">
                Home System
              </span>
            )}
            {shipIsHere && !isSol && (
              <span className="rounded-full bg-indigo-900/50 px-2 py-0.5 text-xs font-medium text-indigo-300">
                {shipList.filter((s) => s.current_system_id === systemId).length > 1
                  ? "Ships present"
                  : "Ship present"}
              </span>
            )}
            {inTransitHere && (
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
                In transit
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {spectralLabel(system.spectralClass)} ·{" "}
            {catalogEntry.distance.toFixed(2)} ly from Sol ·{" "}
            {system.bodyCount} bod{system.bodyCount !== 1 ? "ies" : "y"}
          </p>
        </div>

        {/* System ID pill */}
        <span className="shrink-0 font-mono text-xs text-zinc-700">
          {systemId}
        </span>
      </div>

      {/* Status row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Discovery status */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Discovery
          </p>
          {isSol ? (
            <p className="mt-1 text-sm text-amber-300">
              Canonical home system — always known
            </p>
          ) : myDiscovery ? (
            <div>
              <p className="mt-1 text-sm text-emerald-300">
                {myDiscovery.is_first
                  ? "You discovered this system first"
                  : "Discovered by you"}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">
                {new Date(myDiscovery.discovered_at).toLocaleDateString()}
              </p>
              {!myDiscovery.is_first && firstDiscovererHandle && (
                <p className="mt-0.5 text-xs text-zinc-500">
                  First discovered by{" "}
                  <span className="text-zinc-400">{firstDiscovererHandle}</span>
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="mt-1 text-sm text-zinc-400">
                Not yet discovered by you
              </p>
              {firstDiscovererHandle && (
                <p className="mt-0.5 text-xs text-zinc-500">
                  First discovered by{" "}
                  <span className="text-zinc-400">{firstDiscovererHandle}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Stewardship status */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Stewardship
          </p>
          {isSol ? (
            <p className="mt-1 text-sm text-amber-300">
              No steward — Sol is a protected shared system
            </p>
          ) : stewardship && stewardHandle ? (
            <div>
              <p className="mt-1 text-sm text-zinc-200">
                {stewardHandle === player.handle ? (
                  <span className="text-emerald-300">You</span>
                ) : (
                  stewardHandle
                )}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">
                Since {new Date(stewardship.acquired_at).toLocaleDateString()}
                {stewardship.royalty_rate > 0
                  ? ` · ${stewardship.royalty_rate}% royalty`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">
              No steward yet — first discoverer earns stewardship
            </p>
          )}
        </div>
      </div>

      {/* Travel / discover / arrive actions */}
      {!isSol && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-400">Actions</h2>
          <div className="space-y-3">
            {/* Arrive button — ship is in transit here */}
            {inTransitHere && activeTravelJob && (
              <ArriveButton
                jobId={activeTravelJob.id}
                arriveAt={activeTravelJob.arrive_at}
                systemName={system.name}
              />
            )}

            {/* Discover button — ship is here, system not yet discovered */}
            {shipIsHere && !myDiscovery && (
              <DiscoverButton systemId={systemId} systemName={system.name} />
            )}

            {/* Travel button — a travelable ship is docked and this system is reachable */}
            {!shipIsHere &&
              !inTransitHere &&
              canTravelHere &&
              travelDistance !== null &&
              travelHours !== null && (
                <TravelButton
                  destinationSystemId={systemId}
                  destinationName={system.name}
                  distanceLy={travelDistance}
                  travelHours={travelHours}
                  shipName={travelableShip?.name}
                />
              )}

            {/* A ship is in transit elsewhere (and no ship is here / heading here) */}
            {activeTravelJob && !inTransitHere && !shipIsHere && !canTravelHere && (
              <p className="text-sm text-zinc-500">
                A ship is en route to{" "}
                <Link
                  href={`/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`}
                  className="text-indigo-400 hover:text-indigo-300"
                >
                  {systemDisplayName(activeTravelJob.to_system_id)}
                </Link>
                .
              </p>
            )}

            {/* Out of range */}
            {!shipIsHere &&
              !inTransitHere &&
              !canTravelHere &&
              travelableShip && (
                <p className="text-sm text-zinc-500">
                  {travelDistance !== null
                    ? `${system.name} is ${travelDistance.toFixed(2)} ly away — beyond your current travel range (${maxRangeLy} ly). Build relay stations to extend your reach.`
                    : "Your ship's current position is unknown."}
                </p>
              )}
          </div>
        </div>
      )}

      {/* Bodies */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Bodies ({system.bodyCount})
        </h2>
        <div className="space-y-2">
          {system.bodies.map((body) => {
            const survey = surveyByBodyId.get(body.id) ?? null;
            const colony = colonyByBodyId.get(body.id) ?? null;
            const bodyIsOccupied =
              colony !== null && colony.status !== "collapsed";
            const myColonyHere =
              colony?.owner_id === player.id && bodyIsOccupied;

            // Per-body action conditions
            const canSurveyThis =
              canActOnBodies && survey === null;

            // Phase 16: harsh planets need research; others need habitability score.
            const isHarshBody = isHarshPlanetType(body.type);
            const harshGateMet = !isHarshBody || hasHarshColonyResearch;
            const habitabilityGateMet = isHarshBody ? true : body.canHostColony;

            // Sol bodies can never be colonized (GAME_RULES.md §1.1).
            // Also suppress the button when the player is at their slot cap
            // (atSlotCap is false for unlimited tier players).
            const canFoundColonyHere =
              canActOnBodies &&
              !isSol &&
              survey !== null &&
              habitabilityGateMet &&
              harshGateMet &&
              !bodyIsOccupied &&
              !atSlotCap;

            return (
              <div
                key={body.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
              >
                {/* Body header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-medium ${
                        isHarshBody
                          ? "text-red-300"
                          : body.type === "lush" || body.type === "ocean" || body.type === "habitable"
                            ? "text-emerald-300"
                            : "text-zinc-200"
                      }`}>
                        {bodyLabel(body.type)}
                      </p>
                      {isHarshBody && (
                        <span className="rounded-full bg-red-950/60 px-1.5 py-0.5 text-xs text-red-400">
                          Harsh
                        </span>
                      )}
                      {body.index === system.anchorBodyIndex && (
                        <span className="text-xs text-zinc-500">(anchor)</span>
                      )}
                    </div>
                    <p className="text-xs capitalize text-zinc-600">
                      {body.size} · index {body.index}
                    </p>
                    {/* Upkeep hint for harsh planets */}
                    {isHarshBody && (
                      <p className="mt-0.5 text-xs text-amber-700">
                        Dome maintenance: food + iron per period
                      </p>
                    )}
                  </div>

                  {/* Right-side badges */}
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {/* Colonization status badge */}
                    {isHarshBody ? (
                      hasHarshColonyResearch ? (
                        <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-xs text-amber-400">
                          Research unlocked
                        </span>
                      ) : (
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                          Needs research
                        </span>
                      )
                    ) : body.canHostColony ? (
                      <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-400">
                        Colonizable
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-700">
                        hab. {body.habitabilityScore}
                      </span>
                    )}
                    {survey && (
                      <span className="rounded-full bg-teal-900/40 px-2 py-0.5 text-xs text-teal-400">
                        Surveyed
                      </span>
                    )}
                    {myColonyHere && colony && (
                      <span className="rounded-full bg-indigo-900/40 px-2 py-0.5 text-xs text-indigo-300">
                        Your colony · Tier {colony.population_tier}
                      </span>
                    )}
                    {bodyIsOccupied && !myColonyHere && colony && (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                        Occupied
                        {colonyOwnerHandles.get(colony.owner_id) && (
                          <> · {colonyOwnerHandles.get(colony.owner_id)}</>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* Survey resource nodes */}
                {survey && survey.resource_nodes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {survey.resource_nodes.map(
                      (node: { type: string; quantity: number; is_rare: boolean }) => (
                        <span
                          key={node.type}
                          className="text-xs"
                        >
                          {node.is_rare ? (
                            <span className="text-amber-400">{node.type}</span>
                          ) : (
                            <span className="text-zinc-400">{node.type}</span>
                          )}{" "}
                          <span className={resourceTierColor(node.quantity)}>
                            {resourceTierLabel(node.quantity)}
                          </span>
                        </span>
                      ),
                    )}
                    {survey.has_deep_nodes && (
                      <span className="text-xs text-zinc-700 italic">
                        + rare deposits (deep survey)
                      </span>
                    )}
                  </div>
                )}

                {/* Colony inventory + load actions (Phase 7) */}
                {(() => {
                  if (!myColonyHere || !colony) return null;
                  const inv = colonyInventoryById.get(colony.id) ?? [];
                  if (inv.length === 0 && !shipIsHere) return null;
                  return (
                    <div className="mt-2 border-t border-zinc-800 pt-2">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-600">
                        Colony inventory
                      </p>
                      {inv.length === 0 ? (
                        <p className="text-xs text-zinc-700">
                          Empty — extract resources from the command centre.
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {inv.map((row) => (
                            <div
                              key={row.resource_type}
                              className="flex items-center gap-3"
                            >
                              <span className="text-xs text-zinc-400">
                                {row.resource_type}{" "}
                                <span className="font-mono text-zinc-300">
                                  ×{row.quantity.toLocaleString()}
                                </span>
                              </span>
                              {loadingShip && (
                                <LoadButton
                                  shipId={loadingShip.id}
                                  colonyId={colony.id}
                                  resourceType={row.resource_type}
                                  available={row.quantity}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Supply routes (Phase 15) — shown for player's active colonies */}
                {myColonyHere && colony && (
                  <div className="mt-2 border-t border-zinc-800 pt-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium uppercase tracking-wider text-zinc-600">
                          Supply Routes
                        </p>
                        <Link
                          href="/game/routes"
                          className="text-xs text-zinc-700 hover:text-zinc-400 transition-colors"
                        >
                          Map →
                        </Link>
                      </div>
                    </div>

                    {/* Phase 18: Transport summary + purchase/upgrade controls */}
                    <div className="mb-2">
                      <TransportPanel
                        colonyId={colony.id}
                        transports={transportsByColonyId.get(colony.id) ?? []}
                        stationIron={stationIronForTransports}
                        stationCarbon={stationCarbonForTransports}
                        stationSteel={stationSteelForTransports}
                      />
                    </div>

                    {/* Outgoing routes */}
                    {(routesByFromColonyId.get(colony.id) ?? []).map((route) => (
                      <div key={route.id} className="flex items-center justify-between gap-2 py-0.5">
                        <span className="text-xs text-zinc-500">
                          → {colonyLabelById.get(route.to_colony_id) ?? route.to_colony_id.slice(0, 8)}
                          <span className="text-zinc-700 ml-1">
                            {route.resource_type} · {route.mode}
                            {route.mode === "fixed" ? ` ×${route.fixed_amount}` : ""}
                            {" "}every {route.interval_minutes}m
                          </span>
                        </span>
                        <DeleteRouteButton routeId={route.id} />
                      </div>
                    ))}

                    {/* Incoming routes */}
                    {(routesByToColonyId.get(colony.id) ?? []).map((route) => (
                      <div key={route.id} className="py-0.5">
                        <span className="text-xs text-zinc-700">
                          ← {colonyLabelById.get(route.from_colony_id) ?? route.from_colony_id.slice(0, 8)}
                          {" "}{route.resource_type} inbound
                        </span>
                      </div>
                    ))}

                    {/* Create new route */}
                    <div className="mt-1.5">
                      <CreateRouteForm
                        fromColonyId={colony.id}
                        destColonies={allActiveColonies
                          .filter((c) => c.id !== colony.id)
                          .map((c) => ({ id: c.id, label: colonyLabelById.get(c.id) ?? c.id }))}
                        resourceTypes={ALL_RESOURCE_TYPES}
                      />
                    </div>
                  </div>
                )}

                {/* Per-body actions */}
                {(canSurveyThis || canFoundColonyHere) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canSurveyThis && (
                      <SurveyButton
                        bodyId={body.id}
                        bodyLabel={bodyLabel(body.type)}
                      />
                    )}
                    {canFoundColonyHere && (
                      <FoundColonyButton
                        bodyId={body.id}
                        bodyLabel={bodyLabel(body.type)}
                        isFirstColony={isFirstColony}
                      />
                    )}
                  </div>
                )}

                {/* Slot cap notice — body is eligible but player is at their cap */}
                {atSlotCap &&
                  canActOnBodies &&
                  !isSol &&
                  survey !== null &&
                  habitabilityGateMet &&
                  harshGateMet &&
                  !bodyIsOccupied && (
                  <p className="mt-2 text-xs text-amber-600">
                    Colony limit reached ({player.colony_slots} / {player.colony_slots}).{" "}
                    Reach the next progression milestone to expand.
                  </p>
                )}

                {/* Sol: surveying is allowed, colonizing is not */}
                {isSol && body.canHostColony && (
                  <p className="mt-2 text-xs text-zinc-600">
                    Sol bodies cannot be colonized — Sol is a protected shared starter system.
                  </p>
                )}

                {/* Ship here but no discovery yet (non-Sol) */}
                {shipIsHere && !hasSystemAccess && !survey && (
                  <p className="mt-2 text-xs text-zinc-600">
                    Discover this system to survey its bodies.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Contextual note when no actions possible */}
        {!shipIsHere && !canActOnBodies && (
          <p className="mt-2 text-xs text-zinc-600">
            Travel here to survey bodies and found colonies.
          </p>
        )}
      </section>

      {/* Nearby systems */}
      {nearbySystems.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Nearby systems (within {maxRangeLy} ly)
          </h2>
          <div className="space-y-2">
            {nearbySystems.map((nearby) => (
              <Link
                key={nearby.id}
                href={`/game/system/${encodeURIComponent(nearby.id)}`}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 transition-colors hover:border-zinc-700"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    {nearby.name}
                  </p>
                  <p className="text-xs text-zinc-600">
                    {spectralLabel(nearby.spectralClass)}
                  </p>
                </div>
                <span className="font-mono text-xs text-zinc-500">
                  {nearby.distanceFromSource.toFixed(2)} ly
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spectralLabel(spectralClass: string): string {
  const labels: Record<string, string> = {
    O: "O-type (blue supergiant)",
    B: "B-type (blue-white)",
    A: "A-type (white)",
    F: "F-type (yellow-white)",
    G: "G-type (yellow dwarf)",
    K: "K-type (orange dwarf)",
    M: "M-type (red dwarf)",
  };
  return labels[spectralClass] ?? spectralClass;
}

function bodyLabel(type: string): string {
  const labels: Record<string, string> = {
    habitable:     "Habitable World",
    lush:          "Lush World",
    ocean:         "Ocean World",
    desert:        "Desert World",
    ice_planet:    "Ice Planet",
    volcanic:      "Volcanic World",
    toxic:         "Toxic World",
    rocky:         "Rocky Planet",
    barren:        "Barren World",
    frozen:        "Frozen World",
    gas_giant:     "Gas Giant",
    ice_giant:     "Ice Giant",
    asteroid_belt: "Asteroid Belt",
  };
  return labels[type] ?? type;
}

/**
 * Convert a raw survey resource quantity to a human-readable tier label.
 * Labels represent the planet's reserve richness, not extraction rate.
 */
function resourceTierLabel(quantity: number): string {
  if (quantity >= 6000) return "Abundant";
  if (quantity >= 2000) return "High";
  if (quantity >= 500)  return "Moderate";
  return "Low";
}

function resourceTierColor(quantity: number): string {
  if (quantity >= 6000) return "text-emerald-400";
  if (quantity >= 2000) return "text-sky-400";
  if (quantity >= 500)  return "text-zinc-400";
  return "text-zinc-600";
}

