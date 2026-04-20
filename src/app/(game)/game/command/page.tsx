/**
 * /game/command — Summary & Dev Tools (demoted from primary hub).
 *
 * The Galaxy Map (/game/map) is now the primary game surface.
 * The Station page (/game/station) is the logistics hub.
 * This page is a lightweight overview + developer tooling.
 *
 * Shows:
 *   - Credits, iron, ship/colony counts at a glance
 *   - Quick links to dedicated management pages
 *   - Dev controls (complete travel, grant resources) for dev accounts
 *
 * Engine tick + travel resolution still runs here so that visiting
 * this page also advances game state (idempotent — safe to run on
 * multiple pages).
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { systemDisplayName } from "@/lib/catalog";
import { BALANCE } from "@/lib/config/balance";
import { runEngineTick } from "@/lib/game/engineTick";
import { runTravelResolution } from "@/lib/game/travelResolution";
import type { Player, Ship, Colony, PlayerStation, TravelJob } from "@/lib/types/game";
import { DevControls } from "./_components/DevControls";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Command — Starfall Atlas",
};

export default async function CommandPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // Engine tick + travel resolution (idempotent — also runs on /game/map)
  const requestTime = new Date();
  await runEngineTick(admin, player.id, requestTime);
  await runTravelResolution(admin, player.id, requestTime);

  // Parallel fetches for summary data
  const [shipsRes, coloniesRes, stationRes, pendingJobsRes] = await Promise.all([
    admin.from("ships").select("id, name, current_system_id, ship_state").eq("owner_id", player.id),
    admin.from("colonies").select("id, system_id, body_id, status, population_tier, upkeep_missed_periods, abandoned_at").eq("owner_id", player.id),
    admin.from("player_stations").select("*").eq("owner_id", player.id).maybeSingle(),
    admin.from("travel_jobs").select("id").eq("player_id", player.id).eq("status", "pending"),
  ]);

  const ships = listResult<Pick<Ship, "id" | "name" | "current_system_id" | "ship_state">>(shipsRes).data ?? [];
  const colonies = listResult<Pick<Colony, "id" | "system_id" | "body_id" | "status" | "population_tier" | "upkeep_missed_periods" | "abandoned_at">>(coloniesRes).data ?? [];
  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;
  const pendingTravelCount = (listResult<Pick<TravelJob, "id">>(pendingJobsRes).data ?? []).length;

  // Station iron
  let stationIron = 0;
  if (station) {
    const { data: ironRow } = await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron")
      .maybeSingle();
    stationIron = (ironRow as { quantity: number } | null)?.quantity ?? 0;
  }

  const dockedShips = ships.filter((s) => s.current_system_id !== null);
  const inTransitShips = ships.filter((s) => s.current_system_id === null);
  const activeColonies = colonies.filter((c) => c.status === "active");
  const neglectedColonies = activeColonies.filter((c) => c.upkeep_missed_periods >= 3);
  const abandonedColonies = colonies.filter((c) => c.status === "abandoned");
  const showDev = player.is_dev || process.env.NODE_ENV !== "production";
  const windowMs = BALANCE.inactivity.resolutionWindowDays * 24 * 3_600_000;

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Command</h1>
          <p className="mt-0.5 text-sm text-zinc-600">
            Overview — use the{" "}
            <Link href="/game/map" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              map
            </Link>{" "}
            and{" "}
            <Link href="/game/station" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              station
            </Link>{" "}
            for gameplay
          </p>
        </div>
      </div>

      {/* Abandoned colony alert */}
      {abandonedColonies.length > 0 && (
        <section className="rounded-lg border border-amber-700 bg-amber-950/30 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-amber-400">
            ⚠ {abandonedColonies.length} abandoned {abandonedColonies.length === 1 ? "colony" : "colonies"} — act now to prevent collapse
          </p>
          <div className="space-y-1.5">
            {abandonedColonies.map((colony) => {
              const bodyIdx = colony.body_id.slice(colony.body_id.lastIndexOf(":") + 1);
              const abandonedAt = colony.abandoned_at ? new Date(colony.abandoned_at) : requestTime;
              const collapseAt = new Date(abandonedAt.getTime() + windowMs);
              const msLeft = collapseAt.getTime() - requestTime.getTime();
              const daysLeft = Math.max(0, Math.floor(msLeft / 86_400_000));
              const hoursLeft = Math.max(0, Math.floor((msLeft % 86_400_000) / 3_600_000));
              return (
                <div key={colony.id} className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs text-zinc-300">
                      {systemDisplayName(colony.system_id)}
                      <span className="ml-1 text-zinc-600">· Body {bodyIdx} · T{colony.population_tier}</span>
                    </span>
                    <span className="ml-2 text-xs text-amber-500">
                      {msLeft > 0
                        ? `collapses in ${daysLeft}d ${hoursLeft}h`
                        : "collapse imminent"}
                    </span>
                  </div>
                  <Link
                    href={`/game/colony/${colony.id}`}
                    className="shrink-0 rounded border border-amber-700/60 bg-amber-900/30 px-2.5 py-0.5 text-xs font-medium text-amber-300 hover:bg-amber-800/40 transition-colors"
                  >
                    Reactivate →
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Dev controls — shown first so dev users see them immediately */}
      {showDev && (
        <section>
          <DevControls
            pendingTravelCount={pendingTravelCount}
            stationId={station?.id ?? null}
            isDev={player.is_dev}
          />
        </section>
      )}

      {/* Asset summary */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Summary
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-center">
            <p className="text-xs text-zinc-600 uppercase tracking-wider">Credits</p>
            <p className="mt-1 font-mono text-lg font-semibold text-amber-300">
              {player.credits.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-center">
            <p className="text-xs text-zinc-600 uppercase tracking-wider">Station Iron</p>
            <p className="mt-1 font-mono text-lg font-semibold text-zinc-200">
              {stationIron.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-center">
            <p className="text-xs text-zinc-600 uppercase tracking-wider">Ships</p>
            <p className="mt-1 font-mono text-lg font-semibold text-zinc-200">
              {dockedShips.length} docked
              {inTransitShips.length > 0 && (
                <span className="ml-1 text-sm text-indigo-400">
                  +{inTransitShips.length} transit
                </span>
              )}
            </p>
          </div>
          <div className={`rounded-lg border px-4 py-3 text-center ${
            neglectedColonies.length > 0
              ? "border-red-900 bg-red-950/20"
              : "border-zinc-800 bg-zinc-900"
          }`}>
            <p className="text-xs text-zinc-600 uppercase tracking-wider">Colonies</p>
            <p className="mt-1 font-mono text-lg font-semibold text-zinc-200">
              {activeColonies.length}
              <span className="text-sm font-normal text-zinc-600">
                {" / "}
                {player.colony_slots >= BALANCE.colony.slotsUnlimited
                  ? "∞"
                  : player.colony_slots}
              </span>
              {neglectedColonies.length > 0 && (
                <span className="ml-1 text-sm text-red-400">
                  {neglectedColonies.length} neglected
                </span>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Station location */}
      {station && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Station
          </h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-200">{station.name}</p>
              <p className="text-xs text-zinc-600">
                {systemDisplayName(station.current_system_id)}
              </p>
            </div>
            <Link
              href="/game/station"
              className="rounded border border-amber-700/60 bg-amber-950/40 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-900/50 transition-colors"
            >
              Manage Station →
            </Link>
          </div>
        </section>
      )}

      {/* Ships overview */}
      {ships.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Ships
          </h2>
          <div className="space-y-2">
            {ships.map((ship) => (
              <div
                key={ship.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-2.5"
              >
                <div>
                  <p className="text-sm text-zinc-300">{ship.name}</p>
                  <p className="text-xs text-zinc-600">
                    {ship.current_system_id
                      ? systemDisplayName(ship.current_system_id)
                      : "In transit…"}
                  </p>
                </div>
                <span className={`text-xs ${
                  ship.current_system_id ? "text-emerald-500" : "text-indigo-400"
                }`}>
                  {ship.current_system_id ? "Docked" : "Traveling"}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-700">
            Dispatch ships from the{" "}
            <Link href="/game/map" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              map
            </Link>{" "}
            or{" "}
            <Link href="/game/station" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              station
            </Link>.
          </p>
        </section>
      )}

      {/* Colonies overview */}
      {colonies.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Colonies
          </h2>
          <div className="space-y-2">
            {colonies.map((colony) => {
              const bodyIdx = colony.body_id.slice(colony.body_id.lastIndexOf(":") + 1);
              const isNeglected = colony.upkeep_missed_periods >= 3;
              const isStruggling = !isNeglected && colony.upkeep_missed_periods >= 1;
              return (
                <div
                  key={colony.id}
                  className={`flex items-center justify-between rounded-lg border px-4 py-2.5 ${
                    colony.status === "abandoned"
                      ? "border-amber-800 bg-amber-950/20"
                      : colony.status === "collapsed"
                        ? "border-zinc-700 bg-zinc-900/30 opacity-60"
                        : isNeglected
                          ? "border-red-900 bg-red-950/20"
                          : isStruggling
                            ? "border-amber-900 bg-amber-950/10"
                            : "border-zinc-800 bg-zinc-900/70"
                  }`}
                >
                  <div>
                    <p className="text-sm text-zinc-300">
                      {systemDisplayName(colony.system_id)}
                      <span className="ml-1.5 text-xs text-zinc-600">
                        · Body {bodyIdx} · T{colony.population_tier}
                      </span>
                    </p>
                    {isNeglected && (
                      <p className="text-xs text-red-400">
                        Neglected ({colony.upkeep_missed_periods} missed periods)
                      </p>
                    )}
                    {isStruggling && (
                      <p className="text-xs text-amber-400">Low supplies</p>
                    )}
                    {colony.status === "abandoned" && (() => {
                      const abandonedAt = colony.abandoned_at ? new Date(colony.abandoned_at) : requestTime;
                      const msLeft = abandonedAt.getTime() + windowMs - requestTime.getTime();
                      const daysLeft = Math.max(0, Math.floor(msLeft / 86_400_000));
                      const hoursLeft = Math.max(0, Math.floor((msLeft % 86_400_000) / 3_600_000));
                      return (
                        <p className="text-xs text-amber-500">
                          Abandoned — {msLeft > 0 ? `collapses in ${daysLeft}d ${hoursLeft}h` : "collapse imminent"}
                        </p>
                      );
                    })()}
                    {colony.status === "collapsed" && (
                      <p className="text-xs text-zinc-600">Collapsed</p>
                    )}
                    {colony.status !== "active" && colony.status !== "abandoned" && colony.status !== "collapsed" && (
                      <p className="text-xs text-zinc-600 capitalize">{colony.status}</p>
                    )}
                  </div>
                  <Link
                    href={`/game/colony/${colony.id}`}
                    className="text-xs text-indigo-500 hover:text-indigo-300 transition-colors"
                  >
                    Details →
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Quick nav */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Navigate
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { href: "/game/map",      label: "Galaxy Map", color: "text-indigo-400 border-indigo-800/40" },
            { href: "/game/station",  label: "Station",    color: "text-amber-400 border-amber-800/40" },
            { href: "/game/research", label: "Research",   color: "text-teal-400 border-teal-800/40" },
            { href: "/game/alliance", label: "Alliance",   color: "text-violet-400 border-violet-800/40" },
            { href: "/game/auctions", label: "Auctions",   color: "text-rose-400 border-rose-800/40" },
            { href: "/game/market",   label: "Market",     color: "text-orange-400 border-orange-800/40" },
            { href: "/game/shop",     label: "Shop",       color: "text-yellow-400 border-yellow-800/40" },
            { href: "/game/messages", label: "Messages",   color: "text-sky-400 border-sky-800/40" },
            { href: "/game/feed",     label: "World Feed", color: "text-zinc-400 border-zinc-700/40" },
          ].map(({ href, label, color }) => (
            <Link
              key={href}
              href={href}
              className={`rounded-lg border bg-zinc-900/50 px-3 py-2.5 text-center text-xs font-medium transition-colors hover:bg-zinc-800/60 ${color}`}
            >
              {label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
