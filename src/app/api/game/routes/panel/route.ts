/**
 * GET /api/game/routes/panel
 *
 * Returns all colonies and supply routes for the Routes tab in StationMapPanel.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import { systemDisplayName } from "@/lib/catalog";
import type { Colony, ColonyRoute } from "@/lib/types/game";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [coloniesRes, routesRes] = await Promise.all([
    admin.from("colonies").select("id, system_id, body_id, population_tier").eq("owner_id", player.id).eq("status", "active").order("created_at", { ascending: true }),
    admin.from("colony_routes").select("*").eq("player_id", player.id).order("created_at", { ascending: true }),
  ]);

  const colonies = (listResult<Pick<Colony, "id" | "system_id" | "body_id" | "population_tier">>(coloniesRes).data ?? []).map((c) => {
    const bodyIndex = c.body_id.slice(c.body_id.lastIndexOf(":") + 1);
    return {
      id: c.id,
      systemId: c.system_id,
      systemName: systemDisplayName(c.system_id),
      bodyIndex,
      populationTier: c.population_tier,
      label: `${systemDisplayName(c.system_id)} · B${bodyIndex} (T${c.population_tier})`,
    };
  });

  const routes = (listResult<ColonyRoute>(routesRes).data ?? []).map((r) => {
    const from = colonies.find((c) => c.id === r.from_colony_id);
    const to   = colonies.find((c) => c.id === r.to_colony_id);
    return {
      id: r.id,
      fromColonyId: r.from_colony_id,
      toColonyId:   r.to_colony_id,
      fromLabel: from?.label ?? r.from_colony_id,
      toLabel:   to?.label   ?? r.to_colony_id,
      resourceType: r.resource_type,
      mode: r.mode,
      fixedAmount: r.fixed_amount ?? null,
      intervalMinutes: r.interval_minutes,
      lastRunAt: r.last_run_at ?? null,
    };
  });

  return Response.json({ ok: true, data: { colonies, routes } });
}
