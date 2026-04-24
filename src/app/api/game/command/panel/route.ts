/**
 * GET /api/game/command/panel
 *
 * Returns ship upgrade data for all player ships:
 * per-stat levels, caps, costs, tier, total budget — all server-computed.
 * Also returns station iron for client-side affordability checks.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { buildShipUpgradeSummary } from "@/lib/game/shipUpgrades";
import { systemDisplayName } from "@/lib/catalog";
import type { Ship, PlayerStation, ResourceInventoryRow, PlayerResearch } from "@/lib/types/game";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [shipsRes, stationRes, researchRes] = await Promise.all([
    admin
      .from("ships")
      .select("id, name, current_system_id, destination_system_id, hull_level, shield_level, cargo_level, engine_level, turret_level, utility_level, cargo_cap, speed_ly_per_hr")
      .eq("owner_id", player.id)
      .order("created_at", { ascending: true }),
    admin.from("player_stations").select("id, current_system_id").eq("owner_id", player.id).maybeSingle(),
    admin.from("player_research").select("research_id").eq("player_id", player.id),
  ]);

  const ships = listResult<Ship>(shipsRes).data ?? [];
  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;
  const unlockedIds = new Set(
    (listResult<Pick<PlayerResearch, "research_id">>(researchRes).data ?? []).map((r) => r.research_id),
  );

  let stationIron = 0;
  if (station) {
    const { data: ironRow } = maybeSingleResult<Pick<ResourceInventoryRow, "quantity">>(
      await admin
        .from("resource_inventory")
        .select("quantity")
        .eq("location_type", "station")
        .eq("location_id", station.id)
        .eq("resource_type", "iron")
        .maybeSingle(),
    );
    stationIron = ironRow?.quantity ?? 0;
  }

  const mappedShips = ships.map((ship) => {
    const summary = buildShipUpgradeSummary(ship, unlockedIds);
    const isDockedAtStation = station && ship.current_system_id === station.current_system_id;
    return {
      id: ship.id,
      name: ship.name,
      tier: summary.tier,
      totalUpgrades: summary.totalUpgrades,
      maxTotalUpgrades: summary.maxTotalUpgrades,
      effectiveCargoCap: summary.effectiveCargoCap,
      effectiveSpeed: summary.effectiveSpeed,
      isDockedAtStation: !!isDockedAtStation,
      isTraveling: ship.current_system_id === null,
      currentSystemName: ship.current_system_id ? systemDisplayName(ship.current_system_id) : null,
      stats: summary.stats,
    };
  });

  return Response.json({
    ok: true,
    data: { ships: mappedShips, stationIron, hasStation: station !== null },
  });
}
