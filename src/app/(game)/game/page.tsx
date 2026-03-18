/**
 * Game dashboard — the primary entry point after authentication.
 *
 * Shows the player's current status:
 *   - Handle / identity
 *   - Current location (Sol — hardcoded for Phase 3; dynamic in Phase 4+)
 *   - Credits balance
 *   - Active colonies count
 *   - Starter ship summary
 *
 * By the time this page renders, bootstrapPlayer() has already been called
 * by the game layout, so the player row and starter ship are guaranteed
 * to exist.
 *
 * TODO(phase-4): Replace hardcoded Sol location with live ship location.
 * TODO(phase-5): Show colony list with tax status.
 * TODO(phase-7): Show hyperspace lane network.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult, listResult } from "@/lib/supabase/utils";
import type { Player, Ship } from "@/lib/types/game";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";

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

  // Count active colonies
  const coloniesResult = await admin
    .from("colonies")
    .select("*", { count: "exact", head: true })
    .eq("owner_id", player.id)
    .eq("status", "active");
  const activeColonyCount = coloniesResult.count ?? 0;

  const shipList = ships ?? [];

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
        <StatusCard
          label="Current location"
          value="Sol System"
          sub="Home system — always reachable"
          accent="indigo"
        />

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
              <ShipRow key={ship.id} ship={ship} />
            ))}
          </div>
        )}
      </section>

      {/* What's next */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">
          Getting started
        </h2>
        <ol className="space-y-1 text-sm text-zinc-500">
          <li>
            <span className="text-zinc-400">1.</span> Explore the galaxy — your
            ship can travel to nearby systems via hyperspace lanes.
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
        <p className="mt-3 text-xs text-zinc-600">
          Travel, survey, and galaxy map are coming in the next phase.
        </p>
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

function ShipRow({ ship }: { ship: Ship }) {
  const location =
    ship.current_system_id === SOL_SYSTEM_ID
      ? "Sol System"
      : ship.current_system_id
        ? `System ${ship.current_system_id}`
        : "In transit";

  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-zinc-200">{ship.name}</p>
        <p className="text-xs text-zinc-500">{location}</p>
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
