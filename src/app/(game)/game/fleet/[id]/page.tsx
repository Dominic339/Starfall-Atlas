/**
 * /game/fleet/[id] — Dedicated Fleet page.
 *
 * Shows a fleet's composition, current location, active travel job,
 * and quick actions (dispatch, disband).
 *
 * Fleets are a coordinated group of ships traveling and operating together.
 * They are typically used for asteroid harvesting or large cargo hauls.
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { systemDisplayName } from "@/lib/catalog";
import { getNearbySystems } from "@/lib/catalog";
import { BALANCE } from "@/lib/config/balance";
import type { Player, Fleet, Ship, TravelJob } from "@/lib/types/game";
import { DisbandFleetButton, DispatchFleetForm } from "../../_components/FleetActions";

export const dynamic = "force-dynamic";

export default async function FleetPage({ params }: { params: { id: string } }) {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // Fetch fleet with member ships
  type FleetWithShips = Fleet & { fleet_ships: { ship_id: string }[] };
  const { data: fleet } = maybeSingleResult<FleetWithShips>(
    await admin
      .from("fleets")
      .select("*, fleet_ships(ship_id)")
      .eq("id", params.id)
      .eq("player_id", player.id)
      .maybeSingle(),
  );
  if (!fleet || fleet.status === "disbanded") notFound();

  const memberShipIds = fleet.fleet_ships.map((fs) => fs.ship_id);

  // Parallel fetches
  const [shipsRes, travelRes] = await Promise.all([
    memberShipIds.length > 0
      ? admin
          .from("ships")
          .select("*")
          .in("id", memberShipIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    admin
      .from("travel_jobs")
      .select("*")
      .eq("fleet_id", fleet.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const memberShips = listResult<Ship>(shipsRes).data ?? [];
  const travelJobs = listResult<TravelJob>(travelRes).data ?? [];
  const activeTravelJob = travelJobs[0] ?? null;

  // Compute ETA if traveling
  let etaDisplay: string | null = null;
  if (activeTravelJob?.arrive_at) {
    const eta = new Date(activeTravelJob.arrive_at);
    const now = new Date();
    const msLeft = eta.getTime() - now.getTime();
    if (msLeft > 0) {
      const hoursLeft = msLeft / 3_600_000;
      if (hoursLeft < 1 / 60) etaDisplay = "arriving soon";
      else if (hoursLeft < 1) etaDisplay = `~${Math.ceil(hoursLeft * 60)} min`;
      else etaDisplay = `~${hoursLeft.toFixed(1)} hr`;
    } else {
      etaDisplay = "arriving soon";
    }
  }

  const fleetSpeed = memberShips.length > 0
    ? Math.min(...memberShips.map((s) => Number(s.speed_ly_per_hr)))
    : 0;

  // Nearby systems for dispatch form
  const nearbySystems: { id: string; name: string }[] = fleet.current_system_id
    ? getNearbySystems(fleet.current_system_id, BALANCE.lanes.baseRangeLy)
        .filter((s) => s.id !== fleet.current_system_id)
        .map((s) => ({ id: s.id, name: s.name }))
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">{fleet.name}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {fleet.status === "traveling" ? (
              <>
                <span className="text-indigo-400">In transit</span>
                {activeTravelJob && (
                  <>
                    {" → "}
                    <Link
                      href={`/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`}
                      className="text-indigo-300 hover:text-indigo-200 transition-colors"
                    >
                      {systemDisplayName(activeTravelJob.to_system_id)}
                    </Link>
                    {etaDisplay && (
                      <span className="ml-2 text-zinc-600">{etaDisplay}</span>
                    )}
                  </>
                )}
              </>
            ) : fleet.current_system_id ? (
              <>
                <Link
                  href={`/game/system/${encodeURIComponent(fleet.current_system_id)}`}
                  className="text-amber-500 hover:text-amber-400 transition-colors"
                >
                  {systemDisplayName(fleet.current_system_id)}
                </Link>
                {" · "}
                <span className="text-zinc-600">staged</span>
              </>
            ) : (
              <span className="text-zinc-600">Unknown location</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/game/map"
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-colors"
          >
            Map →
          </Link>
          <Link
            href="/game/command"
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-colors"
          >
            ← Command
          </Link>
        </div>
      </div>

      {/* Status card */}
      <section>
        <div className={`rounded-lg border px-4 py-3 ${
          fleet.status === "traveling"
            ? "border-indigo-800 bg-zinc-900"
            : "border-zinc-700 bg-zinc-900"
        }`}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                fleet.status === "traveling"
                  ? "bg-indigo-900/50 text-indigo-300"
                  : "bg-zinc-800 text-zinc-300"
              }`}>
                {fleet.status === "traveling" ? "Traveling" : "Staged"}
              </span>
              <span className="text-xs text-zinc-500">
                {memberShips.length} ship{memberShips.length !== 1 ? "s" : ""}
                {fleetSpeed > 0 && (
                  <> · {fleetSpeed.toFixed(2)} ly/hr</>
                )}
              </span>
            </div>
            {fleet.status === "active" && (
              <DisbandFleetButton fleetId={fleet.id} />
            )}
          </div>
        </div>
      </section>

      {/* Member ships */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Member Ships ({memberShips.length})
        </h2>
        {memberShips.length > 0 ? (
          <div className="space-y-2">
            {memberShips.map((ship) => (
              <div
                key={ship.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{ship.name}</p>
                    <p className="text-xs text-zinc-500">
                      {Number(ship.speed_ly_per_hr).toFixed(2)} ly/hr
                      {" · "}
                      {ship.cargo_cap} cargo cap
                    </p>
                  </div>
                  <div className="text-right text-xs text-zinc-600">
                    H:{ship.hull_level ?? 1}
                    {" "}E:{ship.engine_level ?? 1}
                    {" "}S:{ship.shield_level ?? 1}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-center">
            <p className="text-sm text-zinc-600">No ships in this fleet.</p>
          </div>
        )}
      </section>

      {/* Dispatch */}
      {fleet.status === "active" && fleet.current_system_id && nearbySystems.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Dispatch Fleet
          </h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <DispatchFleetForm
              fleetId={fleet.id}
              nearbySystems={nearbySystems}
            />
          </div>
        </section>
      )}

      {/* Travel progress */}
      {fleet.status === "traveling" && activeTravelJob && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            In Transit
          </h2>
          <div className="rounded-lg border border-indigo-900/60 bg-zinc-900 px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-zinc-300">
                  <span className="text-zinc-500">From </span>
                  <Link
                    href={`/game/system/${encodeURIComponent(activeTravelJob.from_system_id)}`}
                    className="text-zinc-300 hover:text-zinc-100"
                  >
                    {systemDisplayName(activeTravelJob.from_system_id)}
                  </Link>
                  <span className="text-zinc-500"> → </span>
                  <Link
                    href={`/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`}
                    className="text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    {systemDisplayName(activeTravelJob.to_system_id)}
                  </Link>
                </p>
                {etaDisplay && (
                  <p className="mt-0.5 text-xs text-zinc-500">{etaDisplay}</p>
                )}
              </div>
              <Link
                href={`/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`}
                className="shrink-0 rounded bg-indigo-800 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-700 transition-colors"
              >
                View destination →
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
