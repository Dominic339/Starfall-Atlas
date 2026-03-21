/**
 * /game/map — 2D Galaxy Navigation Map (Phase 19)
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
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getAllCatalogEntries } from "@/lib/catalog";
import { BALANCE } from "@/lib/config/balance";
import type { Player } from "@/lib/types/game";
import { GalaxyMapClient } from "./_components/GalaxyMapClient";
import type { GalaxySystem, GalaxyShip } from "./_components/GalaxyMapClient";

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

  const admin = createAdminClient();

  // ── Auth ─────────────────────────────────────────────────────────────────
  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // ── Parallel data fetches ─────────────────────────────────────────────────
  const [shipsRes, coloniesRes, discoveriesRes, fleetsRes, travelJobsRes, stewardshipsRes] =
    await Promise.all([
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

      // Non-disbanded fleets with location
      admin
        .from("fleets")
        .select("id, current_system_id, status")
        .eq("player_id", player.id)
        .neq("status", "disbanded"),

      // Active travel jobs (in-transit target)
      admin
        .from("travel_jobs")
        .select("ship_id, to_system_id")
        .eq("player_id", player.id)
        .eq("status", "pending"),

      // All system stewardships (to show who owns each system)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any)
        .from("system_stewardship")
        .select("system_id, steward_id"),
    ]);

  // ── Parse results ─────────────────────────────────────────────────────────
  type ShipRow = { id: string; name: string; current_system_id: string | null; speed_ly_per_hr: number };
  type ColonyRow = { system_id: string };
  type DiscoveryRow = { system_id: string };
  type FleetRow = { id: string; current_system_id: string | null; status: string };
  type TravelRow = { ship_id: string; to_system_id: string };
  type StewardRow = { system_id: string; steward_id: string };

  const ships      = listResult<ShipRow>(shipsRes).data ?? [];
  const colonies   = listResult<ColonyRow>(coloniesRes).data ?? [];
  const discoveries = listResult<DiscoveryRow>(discoveriesRes).data ?? [];
  const fleets     = listResult<FleetRow>(fleetsRes).data ?? [];
  const travelJobs = listResult<TravelRow>(travelJobsRes).data ?? [];
  const stewardships = listResult<StewardRow>(stewardshipsRes).data ?? [];

  // ── Build lookup sets ─────────────────────────────────────────────────────
  const discoveredSystemIds = new Set(discoveries.map((d) => d.system_id));
  const colonySystemIds     = new Map<string, number>(); // systemId → count
  for (const c of colonies) {
    colonySystemIds.set(c.system_id, (colonySystemIds.get(c.system_id) ?? 0) + 1);
  }
  const shipSystemIds   = new Set(ships.filter((s) => s.current_system_id).map((s) => s.current_system_id!));
  const fleetSystemIds  = new Set(fleets.filter((f) => f.current_system_id).map((f) => f.current_system_id!));
  const inTransitTargets = new Set(travelJobs.map((t) => t.to_system_id));
  const stewardMap      = new Map(stewardships.map((s) => [s.system_id, s.steward_id]));

  // Sol is always "discovered" (starting system — no discovery needed)
  discoveredSystemIds.add("sol");

  // ── Determine primary ship (for travel source) ─────────────────────────────
  const dockedShip = ships.find((s) => s.current_system_id != null) ?? null;
  const currentShipSystemId = dockedShip?.current_system_id ?? null;

  // ── Build GalaxySystem array from catalog ─────────────────────────────────
  const catalogEntries = getAllCatalogEntries();
  const projected = projectCatalog([...catalogEntries]);
  const pixelsPerLy = projected[0]?.pixelsPerLy ?? 34;

  const systems: GalaxySystem[] = catalogEntries.map((entry, i) => ({
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
    colonyCount: colonySystemIds.get(entry.id) ?? 0,
    hasDockedShip: shipSystemIds.has(entry.id),
    hasDockedFleet: fleetSystemIds.has(entry.id),
    isCurrentLocation: entry.id === currentShipSystemId,
    isInTransitTarget: inTransitTargets.has(entry.id),
  }));

  // ── Build ship list for client ────────────────────────────────────────────
  const galaxyShips: GalaxyShip[] = ships.map((s) => ({
    id: s.id,
    name: s.name,
    systemId: s.current_system_id,
    speedLyPerHr: s.speed_ly_per_hr,
  }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-200">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-4 border-b border-zinc-800 px-4 py-2">
        <Link
          href="/game"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← Dashboard
        </Link>
        <h1 className="text-sm font-semibold text-zinc-200">Galaxy Map</h1>
        <span className="text-xs text-zinc-600">
          {systems.filter((s) => s.isDiscovered).length}/{systems.length} systems discovered
          {colonies.length > 0 && (
            <> · {colonies.length} {colonies.length === 1 ? "colony" : "colonies"}</>
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
        pixelsPerLy={pixelsPerLy}
        baseRangeLy={BALANCE.lanes.baseRangeLy}
        viewboxW={VIEWBOX_W}
        viewboxH={VIEWBOX_H}
      />
    </div>
  );
}
