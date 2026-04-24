/**
 * GET /api/game/profile/panel
 * Returns the current player's profile data and account stats.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [discRes, coloniesRes, firstDiscRes, allianceRes] = await Promise.all([
    admin.from("system_discoveries").select("id", { count: "exact", head: true }).eq("player_id", player.id),
    admin.from("colonies").select("id", { count: "exact", head: true }).eq("owner_id", player.id).eq("status", "active"),
    admin.from("system_discoveries").select("id", { count: "exact", head: true }).eq("player_id", player.id).eq("is_first", true),
    admin.from("alliance_members").select("role, alliances(name, tag)").eq("player_id", player.id).maybeSingle(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allianceData = allianceRes.data as any;

  // Total ship upgrades across all ships
  const shipsRes = await admin
    .from("ships")
    .select("hull_level, shield_level, cargo_level, engine_level, turret_level, utility_level")
    .eq("owner_id", player.id);
  const ships = (listResult<Record<string, number>>(shipsRes).data ?? []);
  const totalUpgrades = ships.reduce((sum: number, s: Record<string, number>) =>
    sum + (s.hull_level ?? 0) + (s.shield_level ?? 0) + (s.cargo_level ?? 0) +
    (s.engine_level ?? 0) + (s.turret_level ?? 0) + (s.utility_level ?? 0), 0);

  return Response.json({
    ok: true,
    data: {
      handle:      player.handle,
      title:       player.title ?? null,
      bio:         player.bio ?? null,
      credits:     player.credits,
      joinedAt:    player.created_at,
      stats: {
        systemsDiscovered: discRes.count ?? 0,
        firstDiscoveries:  firstDiscRes.count ?? 0,
        activeColonies:    coloniesRes.count ?? 0,
        totalShipUpgrades: totalUpgrades,
      },
      alliance: allianceData ? {
        name: allianceData.alliances?.name ?? null,
        tag:  allianceData.alliances?.tag  ?? null,
        role: allianceData.role ?? null,
      } : null,
    },
  });
}
