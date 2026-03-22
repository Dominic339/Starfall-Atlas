/**
 * POST /api/dev/travel/complete
 *
 * DEV-ONLY: Resolves the full haul chain for the current player in one call.
 *
 * For each pending travel job:
 *   1. Mark job complete + move ship to destination.
 *   2. For auto-mode ships that land at a colony:
 *        - Load all available colony inventory into the ship.
 *        - Teleport the ship to the station (no new travel job).
 *        - Unload all ship cargo to station inventory.
 *        - Reset auto_state to "idle".
 *   3. For auto-mode ships that land at the station with cargo:
 *        - Unload all ship cargo to station inventory.
 *        - Reset auto_state to "idle".
 *   4. Manual-mode ships: leave at destination with no further action.
 *
 * Gated by NODE_ENV !== 'production'. Returns 403 in production.
 *
 * Returns: { ok: true, data: { completed: number, loaded: number, unloaded: number } }
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import type { TravelJob } from "@/lib/types/game";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return toErrorResponse(
      fail("forbidden", "This endpoint is not available in production.").error,
    );
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;

  // ── Fetch all pending travel jobs for this player ─────────────────────
  const { data: pendingJobs } = listResult<TravelJob>(
    await admin
      .from("travel_jobs")
      .select("*")
      .eq("player_id", player.id)
      .eq("status", "pending"),
  );

  if (!pendingJobs || pendingJobs.length === 0) {
    return Response.json({ ok: true, data: { completed: 0, loaded: 0, unloaded: 0 } });
  }

  // ── Fetch station and all ships ───────────────────────────────────────
  const { data: stationRow } = await admin
    .from("player_stations")
    .select("id, current_system_id")
    .eq("owner_id", player.id)
    .maybeSingle();

  const station = stationRow as { id: string; current_system_id: string } | null;

  const { data: allShipRows } = await admin
    .from("ships")
    .select("id, dispatch_mode, auto_state, auto_target_colony_id, cargo_cap")
    .eq("owner_id", player.id);

  const shipMap = new Map<string, {
    id: string;
    dispatch_mode: string;
    auto_state: string | null;
    auto_target_colony_id: string | null;
    cargo_cap: number;
  }>((allShipRows ?? []).map((s: any) => [s.id, s])); // eslint-disable-line @typescript-eslint/no-explicit-any

  // ── Fetch all colonies (needed for loading) ───────────────────────────
  const { data: colonies } = await admin
    .from("colonies")
    .select("id, system_id, status")
    .eq("owner_id", player.id)
    .eq("status", "active");

  const colonyBySystemId = new Map<string, { id: string; system_id: string }>();
  const colonyById = new Map<string, { id: string; system_id: string }>();
  for (const c of (colonies ?? []) as { id: string; system_id: string; status: string }[]) {
    colonyBySystemId.set(c.system_id, c);
    colonyById.set(c.id, c);
  }

  let completed = 0;
  let totalLoaded = 0;
  let totalUnloaded = 0;

  for (const job of pendingJobs) {
    // Step 1: Mark job complete + move ship to destination.
    await adminAny
      .from("travel_jobs")
      .update({ status: "complete" })
      .eq("id", job.id);

    await adminAny
      .from("ships")
      .update({ current_system_id: job.to_system_id, current_body_id: null })
      .eq("id", job.ship_id);

    completed++;

    const shipInfo = shipMap.get(job.ship_id);
    if (!shipInfo || shipInfo.dispatch_mode === "manual" || !station) continue;

    const isAtStation = job.to_system_id === station.current_system_id;
    const colonyAtDest = colonyBySystemId.get(job.to_system_id);
    const targetColony = shipInfo.auto_target_colony_id
      ? colonyById.get(shipInfo.auto_target_colony_id)
      : null;
    const isAtTargetColony =
      targetColony && job.to_system_id === targetColony.system_id;

    // Step 2: Auto ship landed at target colony — load + teleport + unload.
    if (!isAtStation && (isAtTargetColony || colonyAtDest)) {
      const loadColonyId = (isAtTargetColony ? targetColony?.id : colonyAtDest?.id) ?? null;

      if (loadColonyId) {
        // Fetch colony inventory.
        const { data: colonyInv } = await admin
          .from("resource_inventory")
          .select("resource_type, quantity")
          .eq("location_type", "colony")
          .eq("location_id", loadColonyId);

        // Fetch existing ship cargo.
        const { data: existingCargo } = await admin
          .from("resource_inventory")
          .select("resource_type, quantity")
          .eq("location_type", "ship")
          .eq("location_id", job.ship_id);

        const cargoUsed = (existingCargo ?? []).reduce(
          (s: number, r: any) => s + r.quantity, 0, // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        let remaining = shipInfo.cargo_cap - cargoUsed;
        const toLoad: { resource_type: string; quantity: number }[] = [];
        const leftover: { resource_type: string; quantity: number }[] = [];

        for (const item of (colonyInv ?? []) as { resource_type: string; quantity: number }[]) {
          const load = Math.min(item.quantity, remaining);
          if (load > 0) {
            toLoad.push({ resource_type: item.resource_type, quantity: load });
            if (item.quantity > load) leftover.push({ resource_type: item.resource_type, quantity: item.quantity - load });
            remaining -= load;
          } else {
            leftover.push(item);
          }
        }

        if (toLoad.length > 0) {
          // Update colony inventory.
          for (const item of toLoad) {
            const rem = leftover.find((r) => r.resource_type === item.resource_type);
            if (!rem) {
              await adminAny.from("resource_inventory").delete()
                .eq("location_type", "colony").eq("location_id", loadColonyId)
                .eq("resource_type", item.resource_type);
            } else {
              await adminAny.from("resource_inventory")
                .update({ quantity: rem.quantity })
                .eq("location_type", "colony").eq("location_id", loadColonyId)
                .eq("resource_type", item.resource_type);
            }
          }

          // Upsert into ship cargo.
          const existingMap = new Map(
            (existingCargo ?? []).map((r: any) => [r.resource_type, r.quantity]), // eslint-disable-line @typescript-eslint/no-explicit-any
          );
          await adminAny.from("resource_inventory").upsert(
            toLoad.map((item) => ({
              location_type: "ship",
              location_id: job.ship_id,
              resource_type: item.resource_type,
              quantity: (existingMap.get(item.resource_type) ?? 0) + item.quantity,
            })),
            { onConflict: "location_type,location_id,resource_type" },
          );

          totalLoaded += toLoad.reduce((s, r) => s + r.quantity, 0);
        }
      }

      // Teleport ship to station (skip travel job).
      await adminAny.from("ships")
        .update({ current_system_id: station.current_system_id, current_body_id: null })
        .eq("id", job.ship_id);
    }

    // Step 3: Auto ship now at station (landed directly or teleported) — unload.
    const effectivelyAtStation = isAtStation ||
      (!isAtStation && (isAtTargetColony || colonyAtDest));

    if (effectivelyAtStation) {
      const { data: shipCargo } = await admin
        .from("resource_inventory")
        .select("resource_type, quantity")
        .eq("location_type", "ship")
        .eq("location_id", job.ship_id);

      const cargo = (shipCargo ?? []) as { resource_type: string; quantity: number }[];
      if (cargo.length > 0) {
        const rtypes = cargo.map((r) => r.resource_type);
        const { data: stInv } = await admin
          .from("resource_inventory")
          .select("resource_type, quantity")
          .eq("location_type", "station")
          .eq("location_id", station.id)
          .in("resource_type", rtypes);

        const stMap = new Map(
          (stInv ?? []).map((r: any) => [r.resource_type, r.quantity]), // eslint-disable-line @typescript-eslint/no-explicit-any
        );

        await adminAny.from("resource_inventory").upsert(
          cargo.map((item) => ({
            location_type: "station",
            location_id: station.id,
            resource_type: item.resource_type,
            quantity: (stMap.get(item.resource_type) ?? 0) + item.quantity,
          })),
          { onConflict: "location_type,location_id,resource_type" },
        );

        await adminAny.from("resource_inventory").delete()
          .eq("location_type", "ship")
          .eq("location_id", job.ship_id);

        totalUnloaded += cargo.reduce((s, r) => s + r.quantity, 0);
      }

      // Reset auto state.
      await adminAny.from("ships")
        .update({ auto_state: "idle", auto_target_colony_id: null })
        .eq("id", job.ship_id);
    }
  }

  return Response.json({ ok: true, data: { completed, loaded: totalLoaded, unloaded: totalUnloaded } });
}
