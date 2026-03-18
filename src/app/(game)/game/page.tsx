/**
 * Game dashboard — the primary entry point after authentication.
 *
 * Shows the player's current status:
 *   - Handle / identity
 *   - Current location (real ship state: at system, or in transit with ETA)
 *   - Credits balance
 *   - Active colonies count
 *   - Starter ship summary with link to current/destination system
 *   - Nearby systems quick-links (from current location)
 *
 * By the time this page renders, bootstrapPlayer() has already been called
 * by the game layout, so the player row and starter ship are guaranteed
 * to exist.
 *
 * TODO(phase-5): Show colony list with tax status.
 * TODO(phase-7): Show hyperspace lane network.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult, listResult } from "@/lib/supabase/utils";
import { systemDisplayName, getNearbySystems } from "@/lib/catalog";
import { BALANCE } from "@/lib/config/balance";
import type { Player, Ship, TravelJob } from "@/lib/types/game";

// force-dynamic: this page reads the authenticated user session at request time.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Command — Starfall Atlas",
};

export default async function GameDashboard() {
  const user = await getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Fetch player profile
  const { data: player } = singleResult<Player>(
    await admin
      .from("players")
      .select("*")
      .eq("auth_id", user.id)
      .single(),
  );

  if (!player) {
    // Should not happen — layout bootstraps the player before this renders.
    redirect("/login");
  }

  // Fetch player's ships
  const { data: ships } = listResult<Ship>(
    await admin.from("ships").select("*").eq("owner_id", player.id),
  );

  // Fetch pending travel job (in transit?)
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

  // Count active colonies
  const coloniesResult = await admin
    .from("colonies")
    .select("*", { count: "exact", head: true })
    .eq("owner_id", player.id)
    .eq("status", "active");
  const activeColonyCount = coloniesResult.count ?? 0;

  const shipList = ships ?? [];
  const primaryShip = shipList[0] ?? null;

  // ── Location state ──────────────────────────────────────────────────────────
  const isInTransit = activeTravelJob !== null && !primaryShip?.current_system_id;
  const currentSystemId = primaryShip?.current_system_id ?? null;
  const requestTime = new Date();

  // ETA display for in-transit state
  let etaDisplay: string | null = null;
  if (isInTransit && activeTravelJob) {
    const arriveAt = new Date(activeTravelJob.arrive_at);
    const remainingMs = Math.max(0, arriveAt.getTime() - requestTime.getTime());
    const remainingMin = Math.ceil(remainingMs / 60_000);
    etaDisplay =
      remainingMin <= 0
        ? "Arrived — resolve travel"
        : remainingMin < 60
          ? `~${remainingMin} min remaining`
          : `~${(remainingMin / 60).toFixed(1)} hr remaining`;
  }

  // ── Nearby systems (from current location, not in-transit) ─────────────────
  const nearbySystems =
    currentSystemId && !isInTransit
      ? getNearbySystems(currentSystemId, BALANCE.lanes.baseRangeLy).slice(0, 4)
      : [];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">
          Command Centre
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Welcome back, {player.handle}.
        </p>
      </div>

      {/* Status grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Location */}
        <div className="rounded-lg border border-indigo-900 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Current location
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold text-indigo-300 truncate">
            {isInTransit
              ? systemDisplayName(activeTravelJob!.to_system_id)
              : currentSystemId
                ? systemDisplayName(currentSystemId)
                : "Unknown"}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {isInTransit && etaDisplay
              ? etaDisplay
              : currentSystemId
                ? (
                  <Link
                    href={`/game/system/${encodeURIComponent(currentSystemId)}`}
                    className="text-indigo-500 hover:text-indigo-400"
                  >
                    View system →
                  </Link>
                )
                : "Position unknown"}
          </p>
        </div>

        {/* Credits */}
        <StatusCard
          label="Credits"
          value={player.credits.toLocaleString()}
          sub={
            activeColonyCount > 0
              ? "Generating from colony taxes"
              : "Earn credits by founding a colony"
          }
          accent="amber"
        />

        {/* Colonies */}
        <StatusCard
          label="Active colonies"
          value={String(activeColonyCount)}
          sub={`${player.colony_slots} slot${player.colony_slots !== 1 ? "s" : ""} available`}
          accent="emerald"
        />
      </div>

      {/* In-transit banner */}
      {isInTransit && activeTravelJob && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/70 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-300">
              <span className="text-zinc-500">In transit →</span>{" "}
              <Link
                href={`/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`}
                className="text-indigo-400 hover:text-indigo-300 font-medium"
              >
                {systemDisplayName(activeTravelJob.to_system_id)}
              </Link>
            </p>
            {etaDisplay && (
              <p className="text-xs text-zinc-500 mt-0.5">{etaDisplay}</p>
            )}
          </div>
          <Link
            href={`/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`}
            className="shrink-0 rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 transition-colors"
          >
            Go to system
          </Link>
        </div>
      )}

      {/* Ships */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Ships
        </h2>
        {shipList.length === 0 ? (
          <EmptyState message="No ships found. Try refreshing or signing out and back in." />
        ) : (
          <div className="space-y-2">
            {shipList.map((ship) => (
              <ShipRow key={ship.id} ship={ship} activeTravelJob={activeTravelJob} />
            ))}
          </div>
        )}
      </section>

      {/* Nearby systems (shown when ship is docked at a system) */}
      {nearbySystems.length > 0 && currentSystemId && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Nearby systems
          </h2>
          <div className="space-y-2">
            {nearbySystems.map((nearby) => (
              <Link
                key={nearby.id}
                href={`/game/system/${encodeURIComponent(nearby.id)}`}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 transition-colors hover:border-zinc-700"
              >
                <p className="text-sm font-medium text-zinc-200">
                  {nearby.name}
                </p>
                <span className="font-mono text-xs text-zinc-500">
                  {nearby.distanceFromSource.toFixed(2)} ly
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* What's next */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">
          Getting started
        </h2>
        <ol className="space-y-1 text-sm text-zinc-500">
          <li>
            <span className="text-zinc-400">1.</span> Explore the galaxy — your
            ship can travel to nearby systems within {BALANCE.lanes.baseRangeLy} ly.
          </li>
          <li>
            <span className="text-zinc-400">2.</span> Discover a star system to
            become its steward and earn governance rights.
          </li>
          <li>
            <span className="text-zinc-400">3.</span> Survey a planet and claim
            it as your first colony to start generating Credits.
          </li>
        </ol>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "indigo" | "amber" | "emerald";
}) {
  const borderColor = {
    indigo: "border-indigo-900",
    amber: "border-amber-900",
    emerald: "border-emerald-900",
  }[accent];

  const valueColor = {
    indigo: "text-indigo-300",
    amber: "text-amber-300",
    emerald: "text-emerald-300",
  }[accent];

  return (
    <div
      className={`rounded-lg border ${borderColor} bg-zinc-900 p-4`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className={`mt-1 font-mono text-2xl font-semibold ${valueColor}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-zinc-600">{sub}</p>
    </div>
  );
}

function ShipRow({ ship, activeTravelJob }: { ship: Ship; activeTravelJob: TravelJob | null }) {
  const isThisShipInTransit = !ship.current_system_id && activeTravelJob?.ship_id === ship.id;

  let locationDisplay: string;
  if (isThisShipInTransit && activeTravelJob) {
    locationDisplay = `En route → ${systemDisplayName(activeTravelJob.to_system_id)}`;
  } else if (ship.current_system_id) {
    locationDisplay = systemDisplayName(ship.current_system_id);
  } else {
    locationDisplay = "In transit";
  }

  const systemHref = isThisShipInTransit && activeTravelJob
    ? `/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`
    : ship.current_system_id
      ? `/game/system/${encodeURIComponent(ship.current_system_id)}`
      : null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-zinc-200">{ship.name}</p>
        <p className="text-xs text-zinc-500">
          {systemHref ? (
            <Link href={systemHref} className="hover:text-zinc-300 transition-colors">
              {locationDisplay}
            </Link>
          ) : (
            locationDisplay
          )}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs text-zinc-500">
          {ship.speed_ly_per_hr} ly/hr · {ship.cargo_cap} cargo
        </p>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center">
      <p className="text-sm text-zinc-600">{message}</p>
    </div>
  );
}
