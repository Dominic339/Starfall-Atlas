/**
 * System detail page — /game/system/[id]
 *
 * Read-only view of a star system for Phase 4.
 * Shows: name, star class, generated bodies, discovery status, stewardship.
 * Actions (Phase 4): Travel here, Discover (if present and undiscovered).
 * Actions deferred: Survey, Claim colony, Build gate.
 *
 * Sol is handled as a special case: no discovery, no steward, canonical start.
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, singleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry, getNearbySystems, systemDisplayName } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import { distanceBetween } from "@/lib/game/travel";
import { BALANCE } from "@/lib/config/balance";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";
import type {
  Ship,
  Player,
  SystemDiscovery,
  SystemStewardship,
  TravelJob,
} from "@/lib/types/game";
import {
  TravelButton,
  DiscoverButton,
  ArriveButton,
} from "./_components/SystemActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const name = systemDisplayName(decodeURIComponent(id));
  return { title: `${name} — Starfall Atlas` };
}

export default async function SystemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const systemId = decodeURIComponent(rawId);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const user = await getUser();
  if (!user) redirect("/login");

  // ── Catalog lookup ────────────────────────────────────────────────────────
  const catalogEntry = getCatalogEntry(systemId);
  if (!catalogEntry) notFound();

  // ── Generate system data (deterministic, no DB) ───────────────────────────
  const system = generateSystem(systemId, catalogEntry);
  const isSol = systemId === SOL_SYSTEM_ID;

  const admin = createAdminClient();

  // ── Fetch current player and ship ─────────────────────────────────────────
  const { data: player } = singleResult<Player>(
    await admin
      .from("players")
      .select("id, handle, credits, first_colony_placed")
      .eq("auth_id", user.id)
      .single(),
  );

  if (!player) redirect("/login");

  const { data: ship } = singleResult<Ship>(
    await admin.from("ships").select("*").eq("owner_id", player.id).single(),
  );

  // ── Fetch pending travel job (in transit?) ────────────────────────────────
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

  // Is the ship currently in transit TO this system?
  const inTransitHere =
    activeTravelJob?.to_system_id === systemId && !ship?.current_system_id;

  // Is the ship currently AT this system (arrived)?
  const shipIsHere =
    ship?.current_system_id === systemId && !activeTravelJob;

  // ── Discovery / stewardship state ─────────────────────────────────────────
  const { data: myDiscovery } = maybeSingleResult<SystemDiscovery>(
    await admin
      .from("system_discoveries")
      .select("*")
      .eq("system_id", systemId)
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  const { data: stewardship } = maybeSingleResult<SystemStewardship>(
    await admin
      .from("system_stewardship")
      .select("*")
      .eq("system_id", systemId)
      .maybeSingle(),
  );

  // Fetch steward's handle if stewardship exists.
  let stewardHandle: string | null = null;
  if (stewardship) {
    const { data: stewardPlayer } = maybeSingleResult<{ handle: string }>(
      await admin
        .from("players")
        .select("handle")
        .eq("id", stewardship.steward_id)
        .maybeSingle(),
    );
    stewardHandle = stewardPlayer?.handle ?? null;
  }

  // ── Travel reachability from current ship position ────────────────────────
  // Can the player travel to this system right now?
  const maxRangeLy = BALANCE.lanes.baseRangeLy;
  let travelDistance: number | null = null;
  let canTravelHere = false;

  if (ship?.current_system_id && ship.current_system_id !== systemId) {
    const fromEntry = getCatalogEntry(ship.current_system_id);
    if (fromEntry) {
      travelDistance = distanceBetween(
        { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
        { x: catalogEntry.x, y: catalogEntry.y, z: catalogEntry.z },
      );
      canTravelHere = travelDistance <= maxRangeLy;
    }
  }

  const travelHours =
    ship && travelDistance !== null
      ? travelDistance / ship.speed_ly_per_hr
      : null;

  // ── Nearby systems from this system ───────────────────────────────────────
  const nearbySystems = isSol
    ? getNearbySystems(systemId, maxRangeLy)
    : getNearbySystems(systemId, maxRangeLy).slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-xs text-zinc-600">
        <Link href="/game" className="hover:text-zinc-400">
          Command Centre
        </Link>
        {" › "}
        <span className="text-zinc-400">{system.name}</span>
      </nav>

      {/* System header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-zinc-50">
              {system.name}
            </h1>
            {isSol && (
              <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-xs font-medium text-amber-300">
                Home System
              </span>
            )}
            {shipIsHere && !isSol && (
              <span className="rounded-full bg-indigo-900/50 px-2 py-0.5 text-xs font-medium text-indigo-300">
                Ship present
              </span>
            )}
            {inTransitHere && (
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
                In transit
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {spectralLabel(system.spectralClass)} ·{" "}
            {catalogEntry.distance.toFixed(2)} ly from Sol ·{" "}
            {system.bodyCount} bod{system.bodyCount !== 1 ? "ies" : "y"}
          </p>
        </div>

        {/* System ID pill */}
        <span className="shrink-0 font-mono text-xs text-zinc-700">
          {systemId}
        </span>
      </div>

      {/* Status row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Discovery status */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Discovery
          </p>
          {isSol ? (
            <p className="mt-1 text-sm text-amber-300">
              Canonical home system — always known
            </p>
          ) : myDiscovery ? (
            <div>
              <p className="mt-1 text-sm text-emerald-300">
                {myDiscovery.is_first ? "You discovered this system first" : "Discovered by you"}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">
                {new Date(myDiscovery.discovered_at).toLocaleDateString()}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-zinc-400">Not yet discovered by you</p>
          )}
        </div>

        {/* Stewardship status */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Stewardship
          </p>
          {isSol ? (
            <p className="mt-1 text-sm text-amber-300">
              No steward — Sol is unclaimable
            </p>
          ) : stewardship && stewardHandle ? (
            <div>
              <p className="mt-1 text-sm text-zinc-200">
                {stewardHandle === player.handle ? (
                  <span className="text-emerald-300">You</span>
                ) : (
                  stewardHandle
                )}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">
                Since {new Date(stewardship.acquired_at).toLocaleDateString()}
                {stewardship.royalty_rate > 0
                  ? ` · ${stewardship.royalty_rate}% royalty`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">
              No steward yet — first discoverer earns stewardship
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      {!isSol && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-400">Actions</h2>
          <div className="space-y-3">
            {/* Arrive button — ship is in transit here */}
            {inTransitHere && activeTravelJob && (
              <ArriveButton
                jobId={activeTravelJob.id}
                arriveAt={activeTravelJob.arrive_at}
                systemName={system.name}
              />
            )}

            {/* Discover button — ship is here, system not yet discovered */}
            {shipIsHere && !myDiscovery && (
              <DiscoverButton systemId={systemId} systemName={system.name} />
            )}

            {/* Travel button — ship is elsewhere and system is reachable */}
            {!shipIsHere && !inTransitHere && canTravelHere && travelDistance !== null && travelHours !== null && !activeTravelJob && (
              <TravelButton
                destinationSystemId={systemId}
                destinationName={system.name}
                distanceLy={travelDistance}
                travelHours={travelHours}
              />
            )}

            {/* Ship is in transit elsewhere */}
            {activeTravelJob && !inTransitHere && (
              <p className="text-sm text-zinc-500">
                Your ship is en route to{" "}
                <Link
                  href={`/game/system/${encodeURIComponent(activeTravelJob.to_system_id)}`}
                  className="text-indigo-400 hover:text-indigo-300"
                >
                  {systemDisplayName(activeTravelJob.to_system_id)}
                </Link>
                . Travel actions are locked while in transit.
              </p>
            )}

            {/* Out of range */}
            {!shipIsHere && !inTransitHere && !canTravelHere && !activeTravelJob && ship?.current_system_id && (
              <p className="text-sm text-zinc-500">
                {travelDistance !== null
                  ? `${system.name} is ${travelDistance.toFixed(2)} ly away — beyond your current travel range (${maxRangeLy} ly). Build relay stations to extend your reach.`
                  : "Your ship's current position is unknown."}
              </p>
            )}

            {/* No actions available (already here + discovered, etc.) */}
            {shipIsHere && myDiscovery && (
              <p className="text-sm text-zinc-500">
                You are present here.{" "}
                <span className="text-zinc-600">
                  Survey and colony actions coming soon.
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Bodies */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Bodies ({system.bodyCount})
        </h2>
        <div className="space-y-2">
          {system.bodies.map((body) => (
            <div
              key={body.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  {bodyLabel(body.type)}
                  {body.index === system.anchorBodyIndex && (
                    <span className="ml-2 text-xs text-zinc-500">
                      (anchor)
                    </span>
                  )}
                </p>
                <p className="text-xs capitalize text-zinc-600">
                  {body.size} · index {body.index}
                </p>
              </div>
              <div className="text-right">
                {body.canHostColony ? (
                  <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-400">
                    Habitable
                  </span>
                ) : (
                  <span className="text-xs text-zinc-700">
                    hab. {body.habitabilityScore}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        {!myDiscovery && !isSol && (
          <p className="mt-2 text-xs text-zinc-600">
            Survey data available after discovery and survey.
          </p>
        )}
      </section>

      {/* Nearby systems */}
      {nearbySystems.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Nearby systems (within {maxRangeLy} ly)
          </h2>
          <div className="space-y-2">
            {nearbySystems.map((nearby) => (
              <Link
                key={nearby.id}
                href={`/game/system/${encodeURIComponent(nearby.id)}`}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 transition-colors hover:border-zinc-700"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    {nearby.name}
                  </p>
                  <p className="text-xs text-zinc-600">
                    {spectralLabel(nearby.spectralClass)}
                  </p>
                </div>
                <span className="font-mono text-xs text-zinc-500">
                  {nearby.distanceFromSource.toFixed(2)} ly
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spectralLabel(spectralClass: string): string {
  const labels: Record<string, string> = {
    O: "O-type (blue supergiant)",
    B: "B-type (blue-white)",
    A: "A-type (white)",
    F: "F-type (yellow-white)",
    G: "G-type (yellow dwarf)",
    K: "K-type (orange dwarf)",
    M: "M-type (red dwarf)",
  };
  return labels[spectralClass] ?? spectralClass;
}

function bodyLabel(type: string): string {
  const labels: Record<string, string> = {
    habitable: "Habitable World",
    rocky: "Rocky Planet",
    barren: "Barren World",
    frozen: "Frozen World",
    gas_giant: "Gas Giant",
    ice_giant: "Ice Giant",
    asteroid_belt: "Asteroid Belt",
  };
  return labels[type] ?? type;
}
