/**
 * /game/routes — Local Route Map
 *
 * Server component. Fetches:
 *   - Player's active colonies (with system_id, body_id)
 *   - All player supply routes
 *   - Colony transport counts (for gating indicator)
 *
 * Passes serialized data to the client-side RouteMapClient which handles
 * the interactive SVG map and route table panel.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry, systemDisplayName } from "@/lib/catalog";
import type { Colony, ColonyRoute, Player } from "@/lib/types/game";
import { RouteMapClient } from "./_components/RouteMapClient";

// ---------------------------------------------------------------------------
// Types passed to client
// ---------------------------------------------------------------------------

export interface ColonyMapEntry {
  id: string;
  systemId: string;
  systemName: string;
  bodyId: string;
  bodyIndex: number;
  populationTier: number;
  hasTransport: boolean;
  /** 3D catalog position in light-years */
  systemX: number;
  systemY: number;
  systemZ: number;
}

export interface RouteMapEntry {
  id: string;
  fromColonyId: string;
  toColonyId: string;
  resourceType: string;
  mode: "all" | "excess" | "fixed";
  fixedAmount: number | null;
  intervalMinutes: number;
  lastRunAt: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function RoutesPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // ── Auth: get player row ────────────────────────────────────────────────
  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // ── Parallel fetches ────────────────────────────────────────────────────
  const [coloniesRes, routesRes, transportsRes] = await Promise.all([
    admin
      .from("colonies")
      .select("id, system_id, body_id, status, population_tier")
      .eq("owner_id", player.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    admin
      .from("colony_routes")
      .select("*")
      .eq("player_id", player.id)
      .order("created_at", { ascending: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from("colony_transports")
      .select("colony_id")
      .in(
        "colony_id",
        // We'll get colony IDs after the parallel fetch; use a placeholder
        // that returns nothing if we don't have colonies yet. We re-fetch below.
        ["00000000-0000-0000-0000-000000000000"],
      ),
  ]);

  const rawColonies = listResult<Pick<Colony, "id" | "system_id" | "body_id" | "status" | "population_tier">>(coloniesRes).data ?? [];
  const rawRoutes   = listResult<ColonyRoute>(routesRes).data ?? [];

  // Re-fetch transports with correct colony IDs if there are colonies
  let transportColonyIds = new Set<string>();
  if (rawColonies.length > 0) {
    const colonyIds = rawColonies.map((c) => c.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tData } = await (admin as any)
      .from("colony_transports")
      .select("colony_id")
      .in("colony_id", colonyIds);
    for (const row of (tData ?? []) as { colony_id: string }[]) {
      transportColonyIds.add(row.colony_id);
    }
  }

  // ── Build colony map entries ────────────────────────────────────────────
  const colonies: ColonyMapEntry[] = rawColonies.map((c) => {
    const entry = getCatalogEntry(c.system_id);
    const lastColon = c.body_id.lastIndexOf(":");
    const bodyIndex = lastColon >= 0 ? parseInt(c.body_id.slice(lastColon + 1), 10) : 0;
    return {
      id: c.id,
      systemId: c.system_id,
      systemName: systemDisplayName(c.system_id),
      bodyId: c.body_id,
      bodyIndex: isNaN(bodyIndex) ? 0 : bodyIndex,
      populationTier: c.population_tier,
      hasTransport: transportColonyIds.has(c.id),
      systemX: entry?.x ?? 0,
      systemY: entry?.y ?? 0,
      systemZ: entry?.z ?? 0,
    };
  });

  // ── Build route entries ─────────────────────────────────────────────────
  const routes: RouteMapEntry[] = rawRoutes.map((r) => ({
    id: r.id,
    fromColonyId: r.from_colony_id,
    toColonyId: r.to_colony_id,
    resourceType: r.resource_type,
    mode: r.mode,
    fixedAmount: r.fixed_amount,
    intervalMinutes: r.interval_minutes,
    lastRunAt: r.last_run_at,
  }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-200">
      {/* Header bar */}
      <header className="flex shrink-0 items-center gap-4 border-b border-zinc-800 px-4 py-2">
        <Link
          href="/game"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← Dashboard
        </Link>
        <h1 className="text-sm font-semibold text-zinc-200">Supply Route Map</h1>
        <span className="text-xs text-zinc-600">
          {colonies.length} {colonies.length === 1 ? "colony" : "colonies"} ·{" "}
          {routes.length} {routes.length === 1 ? "route" : "routes"}
        </span>
      </header>

      {/* Main content */}
      {colonies.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-zinc-500">No active colonies yet.</p>
            <p className="mt-1 text-xs text-zinc-700">
              Found your first colony to start building supply routes.
            </p>
            <Link
              href="/game"
              className="mt-3 inline-block rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      ) : (
        <RouteMapClient colonies={colonies} initialRoutes={routes} />
      )}
    </div>
  );
}
