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
import { GalaxyMapClient } from "./_components/GalaxyMapClient";
import type { GalaxySystem, GalaxyShip, GalaxyAsteroid, GalaxyFleet, GalaxyBeacon } from "./_components/GalaxyMapClient";

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
  ] = await Promise.all([
    // Ships — need id, current_system_id, name, speed
    admin
      .from("ships")
      .select("id, name, current_system_id, speed_ly_per_hr")
      .eq("owner_id", player.id)
      .order("created_at", { ascending: true }),

    // Active colonies — need system_id
    admin
      .from("colonies")
      .select("system_id")
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

    // Active travel jobs (in-transit target)
    admin
      .from("travel_jobs")
      .select("ship_id, to_system_id")
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
  ]);

  // ── Parse results ─────────────────────────────────────────────────────────
  type ShipRow = { id: string; name: string; current_system_id: string | null; speed_ly_per_hr: number };
  type ColonyRow = { system_id: string };
  type DiscoveryRow = { system_id: string };
  type FleetRow = { id: string; name: string; current_system_id: string | null; status: string };
  type TravelRow = { ship_id: string; to_system_id: string };
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
  const stationSystemId    = (stationRes.data as { current_system_id: string } | null)?.current_system_id ?? null;

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
  for (const c of colonies) {
    colonySystemIds.set(c.system_id, (colonySystemIds.get(c.system_id) ?? 0) + 1);
  }
  const shipSystemIds    = new Set(ships.filter((s) => s.current_system_id).map((s) => s.current_system_id!));
  const fleetSystemIds   = new Set(fleets.filter((f) => f.current_system_id).map((f) => f.current_system_id!));
  const inTransitTargets = new Set(travelJobs.map((t) => t.to_system_id));
  const stewardMap       = new Map(stewardships.map((s) => [s.system_id, s.steward_id]));

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
      colonyCount: colonySystemIds.get(entry.id) ?? 0,
      bodyCount: generated.bodyCount,
      hasDockedShip: shipSystemIds.has(entry.id),
      hasDockedFleet: fleetSystemIds.has(entry.id),
      isCurrentLocation: entry.id === currentShipSystemId,
      isStationLocation: entry.id === stationSystemId,
      isInTransitTarget: inTransitTargets.has(entry.id),
    };
  });

  // ── Build ship list for client ────────────────────────────────────────────
  const galaxyShips: GalaxyShip[] = ships.map((s) => ({
    id: s.id,
    name: s.name,
    systemId: s.current_system_id,
    speedLyPerHr: s.speed_ly_per_hr,
  }));

  // ── Build fleet list for client (needed for dispatch UI) ─────────────────
  const galaxyFleets: GalaxyFleet[] = fleets.map((f) => ({
    id: f.id,
    name: f.name,
    systemId: f.current_system_id,
    isHarvesting: harvestingFleetIds.has(f.id),
  }));

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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-200">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-4 border-b border-zinc-800 px-4 py-2">
        <Link
          href="/game/command"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← Command
        </Link>
        <h1 className="text-sm font-semibold text-zinc-200">Galaxy Map</h1>
        <span className="text-xs text-zinc-600">
          {systems.filter((s) => s.isDiscovered).length}/{systems.length} systems discovered
          {colonies.length > 0 && (
            <> · {colonies.length} {colonies.length === 1 ? "colony" : "colonies"}</>
          )}
          {galaxyAsteroids.length > 0 && (
            <> · {galaxyAsteroids.length} {galaxyAsteroids.length === 1 ? "asteroid" : "asteroids"}</>
          )}
          {galaxyBeacons.length > 0 && (
            <> · {galaxyBeacons.length} {galaxyBeacons.length === 1 ? "beacon" : "beacons"}</>
          )}
        </span>
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-600">
          <Link href="/game/routes" className="hover:text-zinc-400 transition-colors">
            Route Map
          </Link>
        </div>
      </header>

      {/* Map */}
      <GalaxyMapClient
        systems={systems}
        ships={galaxyShips}
        fleets={galaxyFleets}
        asteroids={galaxyAsteroids}
        beacons={galaxyBeacons}
        pixelsPerLy={pixelsPerLy}
        baseRangeLy={BALANCE.lanes.baseRangeLy}
        viewboxW={VIEWBOX_W}
        viewboxH={VIEWBOX_H}
        stationCoords={stationCoords}
      />
    </div>
  );
}
