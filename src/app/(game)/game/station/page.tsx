/**
 * /game/station — Dedicated Station page.
 *
 * Shows the player's core station: inventory, docked ships, credits,
 * and quick links to dispatch / upgrade / refine.
 *
 * The station is the central logistics hub:
 *   - Ships haul resources here from colonies
 *   - Resources are refined or stored here
 *   - Ships are upgraded using iron from station inventory
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { systemDisplayName } from "@/lib/catalog";
import type { Player, Ship, PlayerStation, ResourceInventoryRow } from "@/lib/types/game";
import { UnloadButton } from "../_components/ColonyActions";
import { RefineForm } from "../_components/RefineControls";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Station — Starfall Atlas",
};

export default async function StationPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // Parallel fetches
  const [stationRes, shipsRes] = await Promise.all([
    admin.from("player_stations").select("*").eq("owner_id", player.id).maybeSingle(),
    admin
      .from("ships")
      .select("*")
      .eq("owner_id", player.id)
      .order("created_at", { ascending: true }),
  ]);

  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;
  const ships = listResult<Ship>(shipsRes).data ?? [];

  if (!station) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-zinc-100">Station</h1>
        <p className="text-sm text-zinc-500">
          No station found. Return to{" "}
          <Link href="/game/command" className="text-indigo-400 hover:text-indigo-300">
            Command Centre
          </Link>{" "}
          to trigger bootstrap.
        </p>
      </div>
    );
  }

  // Fetch station inventory and cargo for ships docked at station system
  const dockedShipIds = ships
    .filter((s) => s.current_system_id === station.current_system_id)
    .map((s) => s.id);

  const [invRes, cargoRes] = await Promise.all([
    admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .order("resource_type", { ascending: true }),
    dockedShipIds.length > 0
      ? admin
          .from("resource_inventory")
          .select("location_id, resource_type, quantity")
          .eq("location_type", "ship")
          .in("location_id", dockedShipIds)
      : Promise.resolve({ data: [] }),
  ]);

  const stationInventory = (invRes.data ?? []) as Pick<
    ResourceInventoryRow,
    "resource_type" | "quantity"
  >[];

  type CargoRow = Pick<ResourceInventoryRow, "resource_type" | "quantity"> & {
    location_id: string;
  };
  const cargoByShipId = new Map<string, { resource_type: string; quantity: number }[]>();
  for (const row of (cargoRes.data ?? []) as CargoRow[]) {
    const list = cargoByShipId.get(row.location_id) ?? [];
    list.push({ resource_type: row.resource_type, quantity: row.quantity });
    cargoByShipId.set(row.location_id, list);
  }

  const totalIron =
    stationInventory.find((r) => r.resource_type === "iron")?.quantity ?? 0;

  const dockedShips = ships.filter(
    (s) => s.current_system_id === station.current_system_id,
  );
  const travelingShips = ships.filter((s) => s.current_system_id === null);
  const awayShips = ships.filter(
    (s) =>
      s.current_system_id !== null &&
      s.current_system_id !== station.current_system_id,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">{station.name}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            <Link
              href={`/game/system/${encodeURIComponent(station.current_system_id)}`}
              className="text-amber-500 hover:text-amber-400 transition-colors"
            >
              {systemDisplayName(station.current_system_id)}
            </Link>
            {" · "}
            <span className="text-zinc-600">logistics hub</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/game/map"
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-colors"
          >
            Galaxy Map →
          </Link>
          <Link
            href="/game/command"
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-colors"
          >
            ← Command
          </Link>
        </div>
      </div>

      {/* Credits */}
      <section>
        <div className="rounded-lg border border-amber-900/50 bg-zinc-900 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-zinc-600 uppercase tracking-wider">Credits</p>
              <p className="mt-0.5 font-mono text-2xl font-semibold text-amber-300">
                {player.credits.toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-600 uppercase tracking-wider">Iron</p>
              <p className="mt-0.5 font-mono text-lg font-medium text-zinc-200">
                {totalIron.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Inventory */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Inventory
        </h2>
        {stationInventory.length > 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {stationInventory.map((row) => (
                <div key={row.resource_type} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500 capitalize">
                    {row.resource_type.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono text-sm font-medium text-zinc-200">
                    {row.quantity.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center">
            <p className="text-sm text-zinc-600">
              Inventory is empty — dispatch ships to haul resources from colonies.
            </p>
          </div>
        )}
      </section>

      {/* Refining */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Refine
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
          <RefineForm />
        </div>
      </section>

      {/* Docked ships */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Docked Ships ({dockedShips.length})
        </h2>
        {dockedShips.length > 0 ? (
          <div className="space-y-3">
            {dockedShips.map((ship) => {
              const cargo = cargoByShipId.get(ship.id) ?? [];
              const cargoUsed = cargo.reduce((s, r) => s + r.quantity, 0);
              const cargoParts = cargo.map(
                (r) => `${r.quantity} ${r.resource_type.replace(/_/g, " ")}`,
              );
              const cargoSummary = cargoParts.join(", ") || "empty";
              return (
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
                        {cargoUsed}/{ship.cargo_cap} cargo
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-400">
                      Docked
                    </span>
                  </div>
                  {cargo.length > 0 && (
                    <div className="mt-2 border-t border-zinc-800 pt-2">
                      <p className="text-xs text-zinc-500 mb-1">
                        Cargo: <span className="text-zinc-400">{cargoSummary}</span>
                      </p>
                      <UnloadButton shipId={ship.id} summary={cargoSummary} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-center">
            <p className="text-sm text-zinc-600">No ships docked.</p>
          </div>
        )}
      </section>

      {/* Ships away */}
      {(awayShips.length > 0 || travelingShips.length > 0) && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Ships Away
          </h2>
          <div className="space-y-2">
            {[...awayShips, ...travelingShips].map((ship) => (
              <div
                key={ship.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-2.5 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm text-zinc-300">{ship.name}</p>
                  <p className="text-xs text-zinc-600">
                    {ship.current_system_id
                      ? systemDisplayName(ship.current_system_id)
                      : "In transit…"}
                  </p>
                </div>
                {ship.current_system_id && (
                  <Link
                    href={`/game/system/${encodeURIComponent(ship.current_system_id)}`}
                    className="text-xs text-indigo-500 hover:text-indigo-300 transition-colors"
                  >
                    View →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
