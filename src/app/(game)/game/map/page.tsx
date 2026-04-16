/**
 * /game/map — 2D Galaxy Navigation Map (Phase 19 + Phase 20)
 *
 * Server component. Fetches all player-relevant state and passes it to
 * the client-side GalaxyMapClient for interactive SVG rendering.
 *
 * Shows all 13 alpha-catalog systems annotated with:
 *   - Player discovery status
 *   - Player stewardship
 *   - Colony presence
 *   - Ship / fleet locations
 *   - Active travel target
 *   - Asteroid event nodes (Phase 20)
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getAllCatalogEntries, getCatalogEntry } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import { BALANCE } from "@/lib/config/balance";
import type { Player } from "@/lib/types/game";
import { resolveAsteroidHarvests } from "@/lib/game/asteroids";
import { resolveOverdueDisputes } from "@/lib/game/disputeResolution";
import { GalaxyMapClient } from "./_components/GalaxyMapClient";
import type { GalaxySystem, GalaxyShip, GalaxyAsteroid, GalaxyFleet, GalaxyBeacon, GalaxyTerritory, GalaxyDispute, GalaxyTravelLine, GalaxyOtherStation } from "./_components/GalaxyMapClient";
import { computeAllTerritories } from "@/lib/game/territory";
import { runEngineTick } from "@/lib/game/engineTick";
import { runTravelResolution } from "@/lib/game/travelResolution";

export const dynamic = "force-dynamic";

export const metadata = { title: "Galaxy Map — Starfall Atlas" };

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

const VIEWBOX_W = 1000;
const VIEWBOX_H = 700;
const PAD = 80;

/** Pre-project catalog coordinates to SVG space. Returns {svgX, svgY, pixelsPerLy}. */
function projectCatalog(
  entries: { x: number; y: number }[],
): { svgX: number; svgY: number; pixelsPerLy: number }[] {
  if (entries.length === 0) return [];

  const xs = entries.map((e) => e.x);
  const ys = entries.map((e) => e.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const drawW = VIEWBOX_W - 2 * PAD;
  const drawH = VIEWBOX_H - 2 * PAD;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const scaleX = drawW / rangeX;
  const scaleY = drawH / rangeY;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = PAD + (drawW - rangeX * scale) / 2;
  const offsetY = PAD + (drawH - rangeY * scale) / 2;

  return entries.map((e) => ({
    svgX: offsetX + (e.x - minX) * scale,
    svgY: VIEWBOX_H - (offsetY + (e.y - minY) * scale), // Y inverted
    pixelsPerLy: scale,
  }));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function GalaxyMapPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Auth ─────────────────────────────────────────────────────────────────
  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // ── Engine tick + travel resolution ──────────────────────────────────────
  // Run before data fetches so the UI always reflects resolved arrivals and
  // updated upkeep/growth state without requiring a Command Centre visit.
  const requestTime = new Date();
  await runEngineTick(admin, player.id, requestTime);
  await runTravelResolution(admin, player.id, requestTime);

  // ── Parallel data fetches ─────────────────────────────────────────────────
  const [
    shipsRes,
    coloniesRes,
    discoveriesRes,
    fleetsRes,
    travelJobsRes,
    stewardshipsRes,
    asteroidsRes,
    myHarvestsRes,
    stationRes,
    firstDiscoveriesRes,
    beaconsRes,
    disputesRes,
    allianceMemberRes,
    otherStationsRes,
    allColoniesRes,
  ] = await Promise.all([
    // Ships — include dispatch_mode + auto_state so the map panel can show mode context
    admin
      .from("ships")
      .select("id, name, current_system_id, destination_system_id, dispatch_mode, auto_state, speed_ly_per_hr, cargo_cap, pinned_colony_id")
      .eq("owner_id", player.id)
      .order("created_at", { ascending: true }),

    // Active colonies — need id + system_id (id used to resolve pinned_colony_id → system)
    admin
      .from("colonies")
      .select("id, system_id")
      .eq("owner_id", player.id)
      .eq("status", "active"),

    // Player's system discoveries
    admin
      .from("system_discoveries")
      .select("system_id")
      .eq("player_id", player.id),

    // Non-disbanded fleets with location (include name and id for dispatch UI)
    admin
      .from("fleets")
      .select("id, name, current_system_id, status")
      .eq("player_id", player.id)
      .neq("status", "disbanded"),

    // Active travel jobs (in-transit: need from+to for travel lines + arrive_at/depart_at for ETA + position)
    admin
      .from("travel_jobs")
      .select("id, ship_id, fleet_id, from_system_id, to_system_id, arrive_at, depart_at")
      .eq("player_id", player.id)
      .eq("status", "pending"),

    // All system stewardships (to show who owns each system)
    admin
      .from("system_stewardship")
      .select("system_id, steward_id"),

    // Active asteroid nodes (world objects — all players see them)
    admin
      .from("asteroid_nodes")
      .select("id, system_id, display_offset_x, display_offset_y, resource_type, total_amount, remaining_amount, status, last_resolved_at, spawned_at, expires_at")
      .eq("status", "active"),

    // Player's own active harvests (to show which asteroids they're harvesting)
    admin
      .from("asteroid_harvests")
      .select("id, asteroid_id, fleet_id, harvest_power_per_hr, status, started_at, last_resolved_at")
      .eq("player_id", player.id)
      .eq("status", "active"),

    // Player station — for station location display
    admin
      .from("player_stations")
      .select("current_system_id")
      .eq("owner_id", player.id)
      .maybeSingle(),

    // First discoverers per system (is_first = true) — for panel display
    admin
      .from("system_discoveries")
      .select("system_id, player_id")
      .eq("is_first", true),

    // Active alliance beacons (world-visible — all alliances)
    admin
      .from("alliance_beacons")
      .select("id, alliance_id, system_id")
      .eq("is_active", true),

    // Active disputes (world-visible — all players can see ongoing disputes)
    admin
      .from("disputes")
      .select("id, beacon_id, defending_alliance_id, attacking_alliance_id, resolves_at")
      .eq("status", "open"),

    // Player's alliance membership (for beacon placement button on map)
    admin
      .from("alliance_members")
      .select("alliance_id, role")
      .eq("player_id", player.id)
      .maybeSingle(),

    // All other players' stations (for multiplayer visibility — Phase 1)
    admin
      .from("player_stations")
      .select("id, owner_id, current_system_id")
      .neq("owner_id", player.id),

    // Total active colony count per system across ALL players (for system panel)
    admin
      .from("colonies")
      .select("system_id")
      .eq("status", "active"),
  ]);

  // ── Lazy dispute resolution ───────────────────────────────────────────────
  await resolveOverdueDisputes(admin);

  // ── Parse results ─────────────────────────────────────────────────────────
  type ShipRow = { id: string; name: string; current_system_id: string | null; destination_system_id: string | null; dispatch_mode: string; auto_state: string | null; speed_ly_per_hr: number; cargo_cap: number; pinned_colony_id: string | null };
  type ColonyRow = { id: string; system_id: string };
  type DiscoveryRow = { system_id: string };
  type FleetRow = { id: string; name: string; current_system_id: string | null; status: string };
  type TravelRow = { id: string; ship_id: string; fleet_id: string | null; from_system_id: string; to_system_id: string; arrive_at: string; depart_at: string };
  type StewardRow = { system_id: string; steward_id: string };
  type AsteroidRow = {
    id: string; system_id: string;
    display_offset_x: number; display_offset_y: number;
    resource_type: string; total_amount: number; remaining_amount: number;
    status: string; last_resolved_at: string; spawned_at: string; expires_at: string | null;
  };
  type HarvestRow = {
    id: string; asteroid_id: string; fleet_id: string;
    harvest_power_per_hr: number; status: string;
    started_at: string; last_resolved_at: string;
  };

  type FirstDiscoveryRow = { system_id: string; player_id: string };
  type RawBeaconRow = { id: string; alliance_id: string; system_id: string };
  type RawDisputeRow = {
    id: string;
    beacon_id: string;
    defending_alliance_id: string;
    attacking_alliance_id: string;
    resolves_at: string;
  };
  type OtherStationRow = { id: string; owner_id: string; current_system_id: string | null };
  type AllColonyRow = { system_id: string };

  const ships              = listResult<ShipRow>(shipsRes).data ?? [];
  const colonies           = listResult<ColonyRow>(coloniesRes).data ?? [];
  const discoveries        = listResult<DiscoveryRow>(discoveriesRes).data ?? [];
  const fleets             = listResult<FleetRow>(fleetsRes).data ?? [];
  const travelJobs         = listResult<TravelRow>(travelJobsRes).data ?? [];
  const stewardships       = listResult<StewardRow>(stewardshipsRes).data ?? [];
  const asteroidRows       = listResult<AsteroidRow>(asteroidsRes).data ?? [];
  const myHarvests         = listResult<HarvestRow>(myHarvestsRes).data ?? [];
  const firstDiscoveries   = listResult<FirstDiscoveryRow>(firstDiscoveriesRes).data ?? [];
  const rawBeaconRows      = listResult<RawBeaconRow>(beaconsRes).data ?? [];
  const rawDisputeRows     = listResult<RawDisputeRow>(disputesRes).data ?? [];
  const stationSystemId    = (stationRes.data as { current_system_id: string } | null)?.current_system_id ?? null;
  const otherStationRows   = listResult<OtherStationRow>(otherStationsRes).data ?? [];
  const allColonyRows      = listResult<AllColonyRow>(allColoniesRes).data ?? [];

  // Alliance beacon-placement permissions
  type MemberRow = { alliance_id: string; role: string };
  const membership = (allianceMemberRes as { data: MemberRow | null }).data;
  const playerAllianceId  = membership?.alliance_id ?? null;
  const canPlaceBeacon    = membership?.role === "founder" || membership?.role === "officer";
  // Systems where the player's alliance already has a beacon (block duplicate placement)
  const playerAllianceBeaconSystemIds = playerAllianceId
    ? rawBeaconRows.filter((b) => b.alliance_id === playerAllianceId).map((b) => b.system_id)
    : [];

  // ── Total colony counts per system (all players) ──────────────────────────
  const totalColonyBySystem = new Map<string, number>();
  for (const c of allColonyRows) {
    totalColonyBySystem.set(c.system_id, (totalColonyBySystem.get(c.system_id) ?? 0) + 1);
  }

  // ── Resolve handles for other players' station owners ─────────────────────
  const otherStationOwnerIds = [...new Set(otherStationRows.map((s) => s.owner_id))];
  const otherStationHandles  = new Map<string, string>();
  if (otherStationOwnerIds.length > 0) {
    type HandleRow2 = { id: string; handle: string };
    const { data: stationHandleRows } = listResult<HandleRow2>(
      await admin.from("players").select("id, handle").in("id", otherStationOwnerIds),
    );
    for (const h of stationHandleRows ?? []) otherStationHandles.set(h.id, h.handle);
  }

  // Fetch discoverer handles for first-discovery systems (so panel can show names)
  const firstDiscovererIds = [...new Set(firstDiscoveries.map((d) => d.player_id))];
  type HandleRow = { id: string; handle: string };
  const discovererHandles = new Map<string, string>();
  if (firstDiscovererIds.length > 0) {
    const { data: handleRows } = listResult<HandleRow>(
      await admin.from("players").select("id, handle").in("id", firstDiscovererIds),
    );
    for (const h of handleRows ?? []) discovererHandles.set(h.id, h.handle);
  }
  // Map: systemId → discoverer handle (null if not first-discovered yet)
  const firstDiscovererBySystem = new Map<string, string>();
  for (const d of firstDiscoveries) {
    const handle = discovererHandles.get(d.player_id);
    if (handle) firstDiscovererBySystem.set(d.system_id, handle);
  }

  // ── Resolve beacon alliance tags ──────────────────────────────────────────
  const beaconAllianceIds = [...new Set(rawBeaconRows.map((b) => b.alliance_id))];
  type AllianceTagRow = { id: string; name: string; tag: string };
  const allianceTagMap = new Map<string, { name: string; tag: string }>();
  if (beaconAllianceIds.length > 0) {
    const { data: allianceTagRows } = listResult<AllianceTagRow>(
      await admin.from("alliances").select("id, name, tag").in("id", beaconAllianceIds),
    );
    for (const a of allianceTagRows ?? []) allianceTagMap.set(a.id, { name: a.name, tag: a.tag });
  }

  // ── Lazy resolve asteroids that have active harvests ──────────────────────
  // Find which active asteroids have ANY active harvest (not just this player's)
  // We only resolve if there are active harvests to process.
  const activeAsteroidIds = new Set(asteroidRows.map((a) => a.id));
  const asteroidsBeingHarvested = new Set(myHarvests.map((h) => h.asteroid_id));

  // Resolve all asteroids that have active harvests from this player.
  // This ensures the map shows up-to-date remaining_amount.
  const resolvedAmounts = new Map<string, number>();
  for (const asteroidId of asteroidsBeingHarvested) {
    if (activeAsteroidIds.has(asteroidId)) {
      const newRemaining = await resolveAsteroidHarvests(admin, asteroidId);
      resolvedAmounts.set(asteroidId, newRemaining);
    }
  }

  // ── Build lookup sets ─────────────────────────────────────────────────────
  const discoveredSystemIds = new Set(discoveries.map((d) => d.system_id));
  const colonySystemIds     = new Map<string, number>(); // systemId → count
  // colonyById: colonyId → systemId (for resolving pinned_colony_id → system)
  const colonyById          = new Map<string, string>(colonies.map((c) => [c.id, c.system_id]));
  for (const c of colonies) {
    colonySystemIds.set(c.system_id, (colonySystemIds.get(c.system_id) ?? 0) + 1);
  }
  const shipSystemIds       = new Set(ships.filter((s) => s.current_system_id).map((s) => s.current_system_id!));
  const fleetSystemIds      = new Set(fleets.filter((f) => f.current_system_id).map((f) => f.current_system_id!));
  const inTransitTargets    = new Set(travelJobs.map((t) => t.to_system_id));
  const inTransitOrigins    = new Set(travelJobs.map((t) => t.from_system_id));
  const stewardMap          = new Map(stewardships.map((s) => [s.system_id, s.steward_id]));

  // Set of fleet IDs that are currently harvesting
  const harvestingFleetIds = new Set(myHarvests.map((h) => h.fleet_id));
  // Map: asteroidId → harvestId (player's active harvest on this asteroid)
  const myHarvestByAsteroid = new Map(myHarvests.map((h) => [h.asteroid_id, h.id]));

  // Sol is always "discovered" (starting system — no discovery needed)
  discoveredSystemIds.add("sol");

  // ── Determine primary ship (for travel source) ─────────────────────────────
  const dockedShip = ships.find((s) => s.current_system_id != null) ?? null;
  const currentShipSystemId = dockedShip?.current_system_id ?? null;

  // ── Station coordinates for distance-from-station computation ─────────────
  const stationCatalogEntry = stationSystemId ? getCatalogEntry(stationSystemId) : null;
  const stationCoords = stationCatalogEntry
    ? { x: stationCatalogEntry.x, y: stationCatalogEntry.y, z: stationCatalogEntry.z }
    : null;

  // ── Build GalaxySystem array from catalog ─────────────────────────────────
  const catalogEntries = getAllCatalogEntries();
  const projected = projectCatalog([...catalogEntries]);
  const pixelsPerLy = projected[0]?.pixelsPerLy ?? 34;

  // Build a map from system id → projected coordinates for asteroid positioning
  const systemSvgMap = new Map(
    catalogEntries.map((entry, i) => [entry.id, { svgX: projected[i].svgX, svgY: projected[i].svgY }]),
  );

  // Build GalaxyOtherStation list — must be after systemSvgMap is defined
  const galaxyOtherStations: GalaxyOtherStation[] = otherStationRows
    .filter((s) => s.current_system_id !== null && systemSvgMap.has(s.current_system_id!))
    .map((s) => {
      const pos = systemSvgMap.get(s.current_system_id!)!;
      return {
        id:          s.id,
        ownerId:     s.owner_id,
        ownerHandle: otherStationHandles.get(s.owner_id) ?? "Unknown",
        systemId:    s.current_system_id!,
        svgX:        pos.svgX,
        svgY:        pos.svgY,
      };
    });

  const systems: GalaxySystem[] = catalogEntries.map((entry, i) => {
    // Compute body count deterministically (fast, no DB)
    const generated = generateSystem(entry.id, entry);
    return {
      id: entry.id,
      name: entry.properName ?? entry.id,
      spectralClass: entry.spectralClass,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      distanceFromSol: Math.sqrt(entry.x ** 2 + entry.y ** 2 + entry.z ** 2),
      svgX: projected[i].svgX,
      svgY: projected[i].svgY,
      isDiscovered: discoveredSystemIds.has(entry.id),
      isPlayerSteward: stewardMap.get(entry.id) === player.id,
      discovererHandle: firstDiscovererBySystem.get(entry.id) ?? null,
      colonyCount: totalColonyBySystem.get(entry.id) ?? 0,
      myColonyCount: colonySystemIds.get(entry.id) ?? 0,
      bodyCount: generated.bodyCount,
      hasDockedShip: shipSystemIds.has(entry.id),
      hasDockedFleet: fleetSystemIds.has(entry.id),
      isCurrentLocation: entry.id === currentShipSystemId,
      isStationLocation: entry.id === stationSystemId,
      isInTransitTarget: inTransitTargets.has(entry.id),
      isTransitOrigin: inTransitOrigins.has(entry.id),
    };
  });

  // Map shipId → travel job (for ETA display)
  const travelJobByShipId = new Map(travelJobs.map((tj) => [tj.ship_id, tj]));

  // ── Build ship list for client ────────────────────────────────────────────
  const galaxyShips: GalaxyShip[] = ships.map((s) => {
    const job = s.current_system_id === null ? travelJobByShipId.get(s.id) : undefined;
    return {
      id: s.id,
      name: s.name,
      systemId: s.current_system_id,
      destinationSystemId: s.destination_system_id ?? null,
      arriveAt: job?.arrive_at ?? null,
      dispatchMode: s.dispatch_mode,
      autoState: s.auto_state,
      speedLyPerHr: Number(s.speed_ly_per_hr),
      cargoCap: s.cargo_cap,
      pinnedColonySystemId: s.pinned_colony_id ? (colonyById.get(s.pinned_colony_id) ?? null) : null,
    };
  });

  // ── Build fleet list for client (needed for dispatch UI) ─────────────────
  const galaxyFleets: GalaxyFleet[] = fleets.map((f) => ({
    id: f.id,
    name: f.name,
    systemId: f.current_system_id,
    isHarvesting: harvestingFleetIds.has(f.id),
  }));

  // ── Build travel lines for client ────────────────────────────────────────
  // Deduplicate by fleet_id so fleet members don't produce N identical lines.
  const seenFleetIds = new Set<string>();
  const galaxyTravelLines: GalaxyTravelLine[] = [];
  for (const tj of travelJobs) {
    const fromPos = systemSvgMap.get(tj.from_system_id);
    const toPos   = systemSvgMap.get(tj.to_system_id);
    if (!fromPos || !toPos) continue;

    if (tj.fleet_id) {
      // Fleet job: one line per fleet (skip duplicates from member ships)
      if (seenFleetIds.has(tj.fleet_id)) continue;
      seenFleetIds.add(tj.fleet_id);
      const fleet = fleets.find((f) => f.id === tj.fleet_id);
      galaxyTravelLines.push({
        key: `fleet-${tj.fleet_id}`,
        x1: fromPos.svgX, y1: fromPos.svgY,
        x2: toPos.svgX,   y2: toPos.svgY,
        fromSystemId: tj.from_system_id,
        toSystemId: tj.to_system_id,
        label: fleet?.name ?? "Fleet",
        isFleet: true,
        arriveAt: tj.arrive_at,
        departAt: tj.depart_at,
      });
    } else {
      // Ship job: one line per ship
      const ship = ships.find((s) => s.id === tj.ship_id);
      galaxyTravelLines.push({
        key: `ship-${tj.id}`,
        x1: fromPos.svgX, y1: fromPos.svgY,
        x2: toPos.svgX,   y2: toPos.svgY,
        fromSystemId: tj.from_system_id,
        toSystemId: tj.to_system_id,
        label: ship?.name ?? "Ship",
        isFleet: false,
        arriveAt: tj.arrive_at,
        departAt: tj.depart_at,
      });
    }
  }

  // ── Build asteroid list for client ────────────────────────────────────────
  const galaxyAsteroids: GalaxyAsteroid[] = asteroidRows
    .filter((a) => {
      // Filter out depleted ones that resolved to 0 during this load
      const resolved = resolvedAmounts.get(a.id);
      return resolved === undefined ? true : resolved > 0;
    })
    .map((a) => {
      const systemPos = systemSvgMap.get(a.system_id);
      const remaining = resolvedAmounts.get(a.id) ?? a.remaining_amount;
      return {
        id: a.id,
        systemId: a.system_id,
        svgX: (systemPos?.svgX ?? 500) + a.display_offset_x,
        svgY: (systemPos?.svgY ?? 350) + a.display_offset_y,
        resourceType: a.resource_type,
        totalAmount: a.total_amount,
        remainingAmount: remaining,
        status: a.status as "active" | "depleted" | "expired",
        myHarvestId: myHarvestByAsteroid.get(a.id) ?? null,
      };
    });

  // ── Build beacon list for client ──────────────────────────────────────────
  const galaxyBeacons: GalaxyBeacon[] = rawBeaconRows
    .filter((b) => allianceTagMap.has(b.alliance_id))
    .map((b) => {
      const alliance = allianceTagMap.get(b.alliance_id)!;
      return {
        id: b.id,
        systemId: b.system_id,
        allianceId: b.alliance_id,
        allianceTag: alliance.tag,
        allianceName: alliance.name,
      };
    });

  // ── Compute alliance territories ──────────────────────────────────────────
  // Build catalog lookup: systemId → { x, y }
  const catalogBySystem = new Map(
    catalogEntries.map((e) => [e.id, { x: e.x, y: e.y }]),
  );
  // All catalog systems as 2D points for PIP classification
  const allCatalogSystems = catalogEntries.map((e) => ({
    systemId: e.id,
    x: e.x,
    y: e.y,
  }));

  const territoryResults = computeAllTerritories({
    beacons: rawBeaconRows.map((b) => ({
      id: b.id,
      allianceId: b.alliance_id,
      systemId: b.system_id,
    })),
    alliances: allianceTagMap,
    catalogBySystem,
    allSystems: allCatalogSystems,
    maxLinkDist: BALANCE.alliance.beaconLinkMaxDistanceLy,
  });

  // ── Build dispute list for client ─────────────────────────────────────────
  // Map beacon_id → system_id from beacon rows we already have
  const beaconSystemMap = new Map(rawBeaconRows.map((b) => [b.id, b.system_id]));

  // Collect all unique alliance IDs involved in disputes (may not be in beaconAllianceIds)
  const disputeAllianceIds = [
    ...new Set(
      rawDisputeRows.flatMap((d) => [d.defending_alliance_id, d.attacking_alliance_id]),
    ),
  ].filter((id) => !allianceTagMap.has(id));

  if (disputeAllianceIds.length > 0) {
    type AllianceTagRow2 = { id: string; name: string; tag: string };
    const { data: extraAllianceRows } = listResult<AllianceTagRow2>(
      await admin.from("alliances").select("id, name, tag").in("id", disputeAllianceIds),
    );
    for (const a of extraAllianceRows ?? []) allianceTagMap.set(a.id, { name: a.name, tag: a.tag });
  }

  const galaxyDisputes: GalaxyDispute[] = rawDisputeRows
    .filter((d) => beaconSystemMap.has(d.beacon_id))
    .map((d) => ({
      id:                    d.id,
      beaconId:              d.beacon_id,
      beaconSystemId:        beaconSystemMap.get(d.beacon_id)!,
      defendingAllianceId:   d.defending_alliance_id,
      defendingAllianceTag:  allianceTagMap.get(d.defending_alliance_id)?.tag ?? "?",
      attackingAllianceId:   d.attacking_alliance_id,
      attackingAllianceTag:  allianceTagMap.get(d.attacking_alliance_id)?.tag ?? "?",
      resolvesAt:            d.resolves_at,
    }));

  // Convert territory results to SVG-space GalaxyTerritory objects
  const galaxyTerritories: GalaxyTerritory[] = territoryResults.map((t) => ({
    allianceId: t.allianceId,
    allianceTag: t.allianceTag,
    allianceName: t.allianceName,
    // Convert hull catalog positions → SVG coords
    svgPolygon: t.hullCatalog.map((p) => {
      const pos = systemSvgMap.get(p.systemId);
      return { x: pos?.svgX ?? 0, y: pos?.svgY ?? 0 };
    }),
    systemIds: t.systemsInTerritory,
    // Convert links to SVG line endpoints
    links: t.links.map((lnk) => {
      const from = systemSvgMap.get(lnk.fromSystemId);
      const to   = systemSvgMap.get(lnk.toSystemId);
      return {
        x1: from?.svgX ?? 0,
        y1: from?.svgY ?? 0,
        x2: to?.svgX ?? 0,
        y2: to?.svgY ?? 0,
      };
    }),
  }));

  // Discovery stats for map sub-bar
  const discoveredCount = systems.filter((s) => s.isDiscovered).length;

  return (
    // Full-height flex column — fills the layout's main flex container.
    // The sub-bar is a thin info strip; GalaxyMapClient fills the rest.
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Thin map info bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800/60 bg-zinc-950 px-4 py-1.5 text-xs text-zinc-600">
        <span>
          {discoveredCount}/{systems.length} systems discovered
          {colonies.length > 0 && (
            <> · {colonies.length} {colonies.length === 1 ? "colony" : "colonies"}</>
          )}
          {galaxyAsteroids.length > 0 && (
            <> · {galaxyAsteroids.length} {galaxyAsteroids.length === 1 ? "asteroid" : "asteroids"}</>
          )}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/game/station" className="hover:text-zinc-400 transition-colors">
            Station →
          </Link>
          <Link href="/game/routes" className="hover:text-zinc-400 transition-colors">
            Routes →
          </Link>
        </div>
      </div>

      {/* Map — fills remaining space */}
      <GalaxyMapClient
        systems={systems}
        ships={galaxyShips}
        fleets={galaxyFleets}
        asteroids={galaxyAsteroids}
        beacons={galaxyBeacons}
        territories={galaxyTerritories}
        disputes={galaxyDisputes}
        travelLines={galaxyTravelLines}
        pixelsPerLy={pixelsPerLy}
        baseRangeLy={BALANCE.lanes.baseRangeLy}
        viewboxW={VIEWBOX_W}
        viewboxH={VIEWBOX_H}
        stationCoords={stationCoords}
        playerAllianceId={playerAllianceId}
        canPlaceBeacon={canPlaceBeacon}
        playerAllianceBeaconSystemIds={playerAllianceBeaconSystemIds}
        otherStations={galaxyOtherStations}
      />
    </div>
  );
}
