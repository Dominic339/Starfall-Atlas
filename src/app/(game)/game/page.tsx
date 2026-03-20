/**
 * Game dashboard — Command Centre.
 *
 * Phase 6 additions:
 *   - Core station summary (name, location, resource inventory)
 *   - Both starter ships displayed (Phase 5.5 introduced 2 ships)
 *   - Colony growth auto-resolved lazily on page load
 *   - Resource extraction accrual shown per colony with ExtractButton
 *
 * Phase 7 additions:
 *   - Extraction writes to colony inventory (not station directly)
 *   - Ship cargo displayed with unload action when at station
 *
 * Phase 8 additions:
 *   - Ship dispatch modes: manual / auto_collect_nearest / auto_collect_highest
 *   - Lazy automation loop resolved on every dashboard load:
 *       auto-resolve travel → load colony → travel to station → unload → repeat
 *   - ShipModeSelector dropdown per ship
 *   - Colony inventory fetched to support auto target-selection
 *
 * Phase 9 additions:
 *   - Colony upkeep: iron consumed from station inventory each 24h period
 *   - Health status (well_supplied / struggling / neglected) shown per colony
 *   - Growth blocked when struggling or neglected
 *   - Extraction and tax multipliers applied at collection time
 *   - Tier loss after 5 consecutive missed periods
 *
 * Fetch order:
 *   1. player (auth gate)
 *   2. ships, ALL travel jobs, colonies, station (parallel after player)
 *   3. surveys, station inv, ship cargo, colony inv totals (parallel)
 *   4. lazy growth resolution (DB writes for due colonies)
 *   4.5. lazy upkeep resolution (DB writes per colony; mutates stationIron)
 *   5. lazy auto-ship resolution (DB writes for each automated ship)
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry, systemDisplayName, getNearbySystems } from "@/lib/catalog";
import { distanceBetween, computeArrivalTime } from "@/lib/game/travel";
import { calculateAccumulatedTax } from "@/lib/game/taxes";
import { applyGrowthResolution } from "@/lib/game/taxes";
import { calculateAccumulatedExtraction, formatExtractionSummary } from "@/lib/game/extraction";
import { rankColonyCandidates, autoStateLabel } from "@/lib/game/shipAutomation";
import {
  SHIP_STAT_KEYS,
  SHIP_STAT_LABELS,
  buildShipUpgradeSummary,
  type ShipUpgradeSummary,
} from "@/lib/game/shipUpgrades";
import {
  colonyHealthStatus,
  extractionMultiplier,
  taxMultiplier,
  isGrowthBlocked,
  upkeepPeriodsToResolve,
  resolveColonyUpkeep,
} from "@/lib/game/colonyUpkeep";
import type { ColonyHealthStatus } from "@/lib/game/colonyUpkeep";
import { BALANCE } from "@/lib/config/balance";
import type {
  Player,
  Ship,
  TravelJob,
  Colony,
  PlayerStation,
  ResourceInventoryRow,
  SurveyResult,
  SystemId,
  ColonyId,
} from "@/lib/types/game";
import type { ExtractionAmount } from "@/lib/game/extraction";
import { CollectButton, ExtractButton, UnloadButton } from "./_components/ColonyActions";
import { ShipModeSelector } from "./_components/ShipModeSelector";
import { UpgradeButton } from "./_components/UpgradeButton";
import type { PlayerResearch } from "@/lib/types/game";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Command — Starfall Atlas",
};

export default async function GameDashboard() {
  const user = await getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // ── Step 1: player ────────────────────────────────────────────────────────
  const { data: player } = maybeSingleResult<Player>(
    await admin
      .from("players")
      .select("*")
      .eq("auth_id", user.id)
      .maybeSingle(),
  );

  if (!player) redirect("/login");

  // ── Step 2: parallel fetches that only need player.id ─────────────────────
  const [shipsRes, jobsRes, coloniesRes, stationRes, researchRes] = await Promise.all([
    admin.from("ships").select("*").eq("owner_id", player.id).order("created_at", { ascending: true }),
    // Fetch ALL pending jobs — Phase 8 ships can each have their own job.
    admin
      .from("travel_jobs")
      .select("*")
      .eq("player_id", player.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    admin
      .from("colonies")
      .select("*")
      .eq("owner_id", player.id)
      .order("created_at", { ascending: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from("player_stations")
      .select("*")
      .eq("owner_id", player.id)
      .maybeSingle(),
    // Phase 11: player research for upgrade cap computation
    admin
      .from("player_research")
      .select("research_id")
      .eq("player_id", player.id),
  ]);

  const shipList = listResult<Ship>(shipsRes).data ?? [];
  const allTravelJobs = listResult<TravelJob>(jobsRes).data ?? [];
  // Research unlock set — used for per-ship upgrade cap computation (Phase 11).
  const unlockedResearchIds = new Set(
    (listResult<Pick<PlayerResearch, "research_id">>(researchRes).data ?? []).map(
      (r) => r.research_id,
    ),
  );
  // Per-ship travel job index (used by automation resolver and ShipRow).
  const travelJobByShipId = new Map(allTravelJobs.map((j) => [j.ship_id, j]));
  // Keep a single "active" job for the in-transit banner (first pending job).
  const activeTravelJob = allTravelJobs[0] ?? null;

  const rawColonies = listResult<Colony>(coloniesRes).data ?? [];
  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;

  // ── Step 3: parallel fetches that need colony bodies / station.id ──────────
  const colonyBodyIds = rawColonies.map((c) => c.body_id);
  const shipIds = shipList.map((s) => s.id);
  const activeColonyIds = rawColonies
    .filter((c) => c.status === "active")
    .map((c) => c.id);

  const [surveyRes, invRes, cargoRes, colonyInvRes] = await Promise.all([
    colonyBodyIds.length > 0
      ? admin
          .from("survey_results")
          .select("body_id, resource_nodes")
          .in("body_id", colonyBodyIds)
      : Promise.resolve({ data: [] }),
    station
      ? admin
          .from("resource_inventory")
          .select("resource_type, quantity")
          .eq("location_type", "station")
          .eq("location_id", station.id)
          .order("resource_type", { ascending: true })
      : Promise.resolve({ data: [] }),
    shipIds.length > 0
      ? admin
          .from("resource_inventory")
          .select("location_id, resource_type, quantity")
          .eq("location_type", "ship")
          .in("location_id", shipIds)
      : Promise.resolve({ data: [] }),
    // Colony inventory: needed for auto-ship target selection and loading.
    activeColonyIds.length > 0
      ? admin
          .from("resource_inventory")
          .select("location_id, resource_type, quantity")
          .eq("location_type", "colony")
          .in("location_id", activeColonyIds)
      : Promise.resolve({ data: [] }),
  ]);

  const surveyByBodyId = new Map(
    ((surveyRes.data ?? []) as Pick<SurveyResult, "body_id" | "resource_nodes">[]).map(
      (s) => [s.body_id, s],
    ),
  );

  const stationInventory = (invRes.data ?? []) as Pick<
    ResourceInventoryRow,
    "resource_type" | "quantity"
  >[];

  // Per-ship cargo map (mutable — updated by auto-resolution in Step 5).
  type CargoRow = Pick<ResourceInventoryRow, "resource_type" | "quantity"> & {
    location_id: string;
  };
  const cargoByShipId = new Map<string, { resource_type: string; quantity: number }[]>();
  for (const row of (cargoRes.data ?? []) as CargoRow[]) {
    const list = cargoByShipId.get(row.location_id) ?? [];
    list.push({ resource_type: row.resource_type, quantity: row.quantity });
    cargoByShipId.set(row.location_id, list);
  }

  // Colony inventory maps (mutable — updated by auto-loading in Step 5).
  type ColonyInvRow = Pick<ResourceInventoryRow, "resource_type" | "quantity"> & {
    location_id: string;
  };
  const colonyInvByColonyId = new Map<
    string,
    { resource_type: string; quantity: number }[]
  >();
  const colonyInvTotals = new Map<string, number>();
  for (const row of (colonyInvRes.data ?? []) as ColonyInvRow[]) {
    const list = colonyInvByColonyId.get(row.location_id) ?? [];
    list.push({ resource_type: row.resource_type, quantity: row.quantity });
    colonyInvByColonyId.set(row.location_id, list);
    colonyInvTotals.set(
      row.location_id,
      (colonyInvTotals.get(row.location_id) ?? 0) + row.quantity,
    );
  }

  // ── Step 4: lazy growth resolution ──────────────────────────────────────
  const requestTime = new Date();
  const growthUpdates: { id: string; tier: number; next_growth_at: string | null }[] = [];

  // colonyList is mutable — upkeep resolution in Step 4.5 may lower tier.
  const colonyList: Colony[] = rawColonies.map((colony) => {
    // Growth is blocked when the colony is struggling or neglected (missed ≥ 1).
    if (colony.status !== "active" || !colony.next_growth_at) return colony;
    if (isGrowthBlocked(colony.upkeep_missed_periods)) return colony;
    const { colony: resolved, resolution } = applyGrowthResolution(colony, requestTime);
    if (resolution.tiersGained > 0) {
      growthUpdates.push({
        id: colony.id,
        tier: resolved.population_tier,
        next_growth_at: resolved.next_growth_at,
      });
    }
    return resolved;
  });

  if (growthUpdates.length > 0) {
    await Promise.all(
      growthUpdates.map(({ id, tier, next_growth_at }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (admin as any)
          .from("colonies")
          .update({ population_tier: tier, next_growth_at })
          .eq("id", id),
      ),
    );
  }

  // ── Step 4.5: lazy upkeep resolution ─────────────────────────────────────
  // For each active colony, advance overdue upkeep periods by drawing iron
  // from the station inventory. Processing is sequential per colony so that
  // iron drawn for one colony reduces what is available to the next.
  //
  // stationIron is tracked in memory and updated after each colony so that
  // the rendered station inventory reflects what actually remains.
  //
  // DB updates: colonies (tier, missed_periods, last_upkeep_at, next_growth_at)
  //             resource_inventory (station iron quantity or deletion)

  // Find current station iron from the already-fetched stationInventory.
  let stationIron = stationInventory.find((r) => r.resource_type === "iron")?.quantity ?? 0;
  let totalIronDrawn = 0;

  for (let ci = 0; ci < colonyList.length; ci++) {
    const colony = colonyList[ci];
    if (colony.status !== "active") continue;

    const periods = upkeepPeriodsToResolve(colony.last_upkeep_at, requestTime);
    if (periods === 0) continue;

    const result = resolveColonyUpkeep(colony, periods, stationIron, requestTime);

    if (result.ironConsumed > 0) {
      stationIron -= result.ironConsumed;
      totalIronDrawn += result.ironConsumed;
    }

    // Build the colony update payload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upkeepPatch: Record<string, any> = {
      last_upkeep_at: result.newLastUpkeepAt,
      upkeep_missed_periods: result.newMissedPeriods,
    };
    if (result.newTier !== colony.population_tier) {
      upkeepPatch.population_tier = result.newTier;
      upkeepPatch.next_growth_at = result.newNextGrowthAt;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("colonies")
      .update(upkeepPatch)
      .eq("id", colony.id);

    // Update in-memory colony for rendering.
    colonyList[ci] = {
      ...colony,
      last_upkeep_at: result.newLastUpkeepAt,
      upkeep_missed_periods: result.newMissedPeriods,
      population_tier: result.newTier,
      next_growth_at: result.newTier !== colony.population_tier
        ? result.newNextGrowthAt
        : colony.next_growth_at,
    };
  }

  // Update in-memory station iron so the rendered inventory is correct.
  if (totalIronDrawn > 0) {
    const newIron = stationIron; // already decremented above
    if (newIron <= 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("resource_inventory")
        .delete()
        .eq("location_type", "station")
        .eq("location_id", station?.id)
        .eq("resource_type", "iron");
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("resource_inventory")
        .upsert(
          [{ location_type: "station", location_id: station?.id, resource_type: "iron", quantity: newIron }],
          { onConflict: "location_type,location_id,resource_type" },
        );
    }
    // Reflect the updated iron in the rendered station inventory.
    const ironIdx = stationInventory.findIndex((r) => r.resource_type === "iron");
    if (ironIdx >= 0) {
      if (newIron <= 0) {
        stationInventory.splice(ironIdx, 1);
      } else {
        stationInventory[ironIdx] = { resource_type: "iron", quantity: newIron };
      }
    }
  }

  // ── Step 5: lazy auto-ship resolution ─────────────────────────────────────
  // For each ship in an auto mode, advance its state machine by one meaningful
  // step. Loading and unloading are instantaneous; travel is time-gated.
  //
  // State transitions on a single page load:
  //   pending job arrived  → resolve travel → then advance state
  //   traveling_to_colony  → arrived → load → start return travel
  //   traveling_to_station → arrived → unload → find next colony / idle
  //   idle                 → find colony → start travel (or stay idle)
  //
  // All DB writes update the mutable maps so ShipRow renders current state.

  const resolvedShipList: Ship[] = [...shipList];

  if (station) {
    // Non-null capture for closures — TypeScript can't narrow `station` through inner async fns.
    const st = station;
    for (let si = 0; si < resolvedShipList.length; si++) {
      let ship = resolvedShipList[si];
      if (ship.dispatch_mode === "manual") continue;

      const mode = ship.dispatch_mode as
        | "auto_collect_nearest"
        | "auto_collect_highest";

      // ── 5a: auto-resolve travel if the ship has arrived ──────────────────
      const pendingJob = travelJobByShipId.get(ship.id);
      if (pendingJob) {
        if (new Date(pendingJob.arrive_at) <= requestTime) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any)
            .from("travel_jobs")
            .update({ status: "complete" })
            .eq("id", pendingJob.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any)
            .from("ships")
            .update({ current_system_id: pendingJob.to_system_id, current_body_id: null })
            .eq("id", ship.id);
          ship = {
            ...ship,
            current_system_id: pendingJob.to_system_id as SystemId,
            current_body_id: null,
          };
          travelJobByShipId.delete(ship.id);
        } else {
          // Still in transit — nothing further to advance this cycle.
          resolvedShipList[si] = ship;
          continue;
        }
      }

      // ── 5b: advance state machine based on current position ──────────────

      // Helper: load all available colony inventory into ship cargo (up to cap).
      // Mutates colonyInvByColonyId, colonyInvTotals, cargoByShipId in place.
      // Returns the quantity loaded.
      async function doLoad(colonyId: string): Promise<number> {
        const colonyInv = colonyInvByColonyId.get(colonyId) ?? [];
        const currentCargo = cargoByShipId.get(ship.id) ?? [];
        const cargoUsed = currentCargo.reduce((s, r) => s + r.quantity, 0);
        let remaining = ship.cargo_cap - cargoUsed;
        if (remaining <= 0 || colonyInv.length === 0) return 0;

        const toLoad: { resource_type: string; quantity: number }[] = [];
        const leftoverInv: { resource_type: string; quantity: number }[] = [];

        for (const item of colonyInv) {
          const load = Math.min(item.quantity, remaining);
          if (load > 0) {
            toLoad.push({ resource_type: item.resource_type, quantity: load });
            if (item.quantity > load) {
              leftoverInv.push({ resource_type: item.resource_type, quantity: item.quantity - load });
            }
            remaining -= load;
          } else {
            leftoverInv.push(item);
          }
        }

        if (toLoad.length === 0) return 0;

        // Update colony inventory in DB.
        for (const item of toLoad) {
          const leftover = leftoverInv.find((r) => r.resource_type === item.resource_type);
          if (!leftover) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from("resource_inventory")
              .delete()
              .eq("location_type", "colony")
              .eq("location_id", colonyId)
              .eq("resource_type", item.resource_type);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from("resource_inventory")
              .update({ quantity: leftover.quantity })
              .eq("location_type", "colony")
              .eq("location_id", colonyId)
              .eq("resource_type", item.resource_type);
          }
        }

        // Update colony inventory in memory.
        colonyInvByColonyId.set(colonyId, leftoverInv);
        const newTotal = leftoverInv.reduce((s, r) => s + r.quantity, 0);
        colonyInvTotals.set(colonyId, newTotal);

        // Upsert ship cargo in DB.
        const existingMap = new Map(currentCargo.map((r) => [r.resource_type, r.quantity]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any)
          .from("resource_inventory")
          .upsert(
            toLoad.map((item) => ({
              location_type: "ship",
              location_id: ship.id,
              resource_type: item.resource_type,
              quantity: (existingMap.get(item.resource_type) ?? 0) + item.quantity,
            })),
            { onConflict: "location_type,location_id,resource_type" },
          );

        // Update cargo in memory.
        const newCargo = [...currentCargo];
        for (const loaded of toLoad) {
          const ex = newCargo.find((r) => r.resource_type === loaded.resource_type);
          if (ex) ex.quantity += loaded.quantity;
          else newCargo.push({ resource_type: loaded.resource_type, quantity: loaded.quantity });
        }
        cargoByShipId.set(ship.id, newCargo);

        return toLoad.reduce((s, r) => s + r.quantity, 0);
      }

      // Helper: start travel from ship's current system to targetSystemId.
      // Mutates travelJobByShipId. Returns true on success.
      async function startTravel(targetSystemId: string): Promise<boolean> {
        if (!ship.current_system_id) return false;
        const fromEntry = getCatalogEntry(ship.current_system_id);
        const toEntry = getCatalogEntry(targetSystemId);
        if (!fromEntry || !toEntry) return false;

        const dist = distanceBetween(
          { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
          { x: toEntry.x, y: toEntry.y, z: toEntry.z },
        );
        if (dist > BALANCE.lanes.baseRangeLy) return false;

        const arriveAt = computeArrivalTime(requestTime, dist, ship.speed_ly_per_hr);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any)
          .from("ships")
          .update({ current_system_id: null, current_body_id: null })
          .eq("id", ship.id);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newJob } = await (admin as any)
          .from("travel_jobs")
          .insert({
            ship_id: ship.id,
            player_id: player!.id,
            from_system_id: ship.current_system_id,
            to_system_id: targetSystemId,
            depart_at: requestTime.toISOString(),
            arrive_at: arriveAt.toISOString(),
            transit_tax_paid: 0,
            status: "pending",
          })
          .select("*")
          .maybeSingle();

        if (newJob) {
          travelJobByShipId.set(ship.id, newJob as TravelJob);
        }
        ship = { ...ship, current_system_id: null, current_body_id: null };
        return true;
      }

      // Helper: find best target colony and dispatch; set auto_state.
      // Returns the updated ship.
      async function dispatchToNextColony(): Promise<Ship> {
        const candidates = rankColonyCandidates(
          ship,
          colonyList.filter((c) => c.status === "active"),
          colonyInvTotals,
          mode,
        );

        if (candidates.length === 0) {
          // No colony has inventory — stay idle.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any)
            .from("ships")
            .update({ auto_state: "idle", auto_target_colony_id: null })
            .eq("id", ship.id);
          return { ...ship, auto_state: "idle", auto_target_colony_id: null };
        }

        const target = candidates[0];

        if (target.distanceLy === 0) {
          // Colony in same system: load immediately, then depart to station.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any)
            .from("ships")
            .update({ auto_state: "traveling_to_colony", auto_target_colony_id: target.colonyId })
            .eq("id", ship.id);
          ship = {
            ...ship,
            auto_state: "traveling_to_colony",
            auto_target_colony_id: target.colonyId as ColonyId,
          };

          // Immediately load (same system = no travel needed).
          const loaded = await doLoad(target.colonyId);

          if (loaded > 0 || (cargoByShipId.get(ship.id) ?? []).length > 0) {
            const departed = await startTravel(st.current_system_id); // st is non-null (outer guard)
            const nextState = departed ? "traveling_to_station" : "idle";
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from("ships")
              .update({ auto_state: nextState, auto_target_colony_id: target.colonyId })
              .eq("id", ship.id);
            return { ...ship, auto_state: nextState, auto_target_colony_id: target.colonyId as ColonyId };
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from("ships")
              .update({ auto_state: "idle", auto_target_colony_id: null })
              .eq("id", ship.id);
            return { ...ship, auto_state: "idle", auto_target_colony_id: null };
          }
        }

        // Colony in a different system: start travel.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any)
          .from("ships")
          .update({ auto_state: "traveling_to_colony", auto_target_colony_id: target.colonyId })
          .eq("id", ship.id);
        ship = {
          ...ship,
          auto_state: "traveling_to_colony",
          auto_target_colony_id: target.colonyId as ColonyId,
        };

        const departed = await startTravel(target.systemId);
        if (!departed) {
          // Travel blocked (e.g. catalog miss) — reset to idle.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any)
            .from("ships")
            .update({ auto_state: "idle", auto_target_colony_id: null })
            .eq("id", ship.id);
          return { ...ship, current_system_id: ship.current_system_id, auto_state: "idle", auto_target_colony_id: null };
        }

        return { ...ship, auto_state: "traveling_to_colony", auto_target_colony_id: target.colonyId as ColonyId };
      }

      // ── State machine ─────────────────────────────────────────────────────

      if (ship.auto_state === "traveling_to_colony") {
        const targetColony = colonyList.find((c) => c.id === ship.auto_target_colony_id);

        if (targetColony && ship.current_system_id === targetColony.system_id) {
          const loaded = await doLoad(targetColony.id);

          if (loaded > 0 || (cargoByShipId.get(ship.id) ?? []).length > 0) {
            const departed = await startTravel(st.current_system_id);
            const nextState = departed ? "traveling_to_station" : "idle";
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from("ships")
              .update({ auto_state: nextState })
              .eq("id", ship.id);
            ship = { ...ship, auto_state: nextState };
          } else {
            // Nothing to load and no existing cargo — go idle.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from("ships")
              .update({ auto_state: "idle", auto_target_colony_id: null })
              .eq("id", ship.id);
            ship = { ...ship, auto_state: "idle", auto_target_colony_id: null };
          }
        }
        // else: travel wasn't resolved yet (arrived at wrong system?), leave as-is.
      } else if (ship.auto_state === "traveling_to_station") {
        if (ship.current_system_id === st.current_system_id) {
          // Unload cargo to station.
          const cargo = cargoByShipId.get(ship.id) ?? [];
          if (cargo.length > 0) {
            const rtypes = cargo.map((r) => r.resource_type);
            const { data: stRows } = await admin
              .from("resource_inventory")
              .select("resource_type, quantity")
              .eq("location_type", "station")
              .eq("location_id", st.id)
              .in("resource_type", rtypes);

            const stMap = new Map(
              (stRows ?? []).map((r) => [
                (r as { resource_type: string }).resource_type,
                (r as { quantity: number }).quantity,
              ]),
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from("resource_inventory")
              .upsert(
                cargo.map((item) => ({
                  location_type: "station",
                  location_id: st.id,
                  resource_type: item.resource_type,
                  quantity: (stMap.get(item.resource_type) ?? 0) + item.quantity,
                })),
                { onConflict: "location_type,location_id,resource_type" },
              );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from("resource_inventory")
              .delete()
              .eq("location_type", "ship")
              .eq("location_id", ship.id);

            cargoByShipId.set(ship.id, []);
          }

          // Find next colony.
          ship = { ...ship, auto_state: "idle", auto_target_colony_id: null };
          ship = await dispatchToNextColony();
        }
        // else: travel wasn't resolved, leave as-is.
      } else {
        // idle (or null) — find and dispatch.
        ship = await dispatchToNextColony();
      }

      resolvedShipList[si] = ship;
    }
  }

  // ── Phase 11: per-ship upgrade summaries ──────────────────────────────────
  // Computed after auto-resolution so resolvedShipList reflects current state.
  // Station iron needed for affordability checks.
  const stationIronForUpgrades =
    stationInventory.find((r) => r.resource_type === "iron")?.quantity ?? 0;

  const upgradeByShipId = new Map<string, ShipUpgradeSummary>();
  for (const ship of resolvedShipList) {
    upgradeByShipId.set(ship.id, buildShipUpgradeSummary(ship, unlockedResearchIds));
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const activeColonyCount = colonyList.filter((c) => c.status === "active").length;

  const currentSystemId =
    resolvedShipList.find((s) => s.current_system_id != null)?.current_system_id ?? null;

  const isAnyInTransit = resolvedShipList.some(
    (s) => !s.current_system_id && travelJobByShipId.has(s.id),
  );

  // ETA for the dashboard banner (show for the first in-transit ship's job).
  const bannerJob =
    allTravelJobs.find((j) =>
      resolvedShipList.some((s) => !s.current_system_id && s.id === j.ship_id),
    ) ?? null;
  let etaDisplay: string | null = null;
  if (bannerJob) {
    const arriveAt = new Date(bannerJob.arrive_at);
    const remainingMs = Math.max(0, arriveAt.getTime() - requestTime.getTime());
    const remainingMin = Math.ceil(remainingMs / 60_000);
    etaDisplay =
      remainingMin <= 0
        ? "Arrived — resolve travel"
        : remainingMin < 60
          ? `~${remainingMin} min remaining`
          : `~${(remainingMin / 60).toFixed(1)} hr remaining`;
  }

  const dockedSystemId =
    resolvedShipList.find((s) => s.current_system_id != null)?.current_system_id ?? null;
  const nearbySystems = dockedSystemId
    ? getNearbySystems(dockedSystemId, BALANCE.lanes.baseRangeLy).slice(0, 4)
    : [];

  // Pre-compute auto-ship target system names for ShipRow display.
  const autoTargetNameByShipId = new Map<string, string>();
  for (const ship of resolvedShipList) {
    if (ship.dispatch_mode !== "manual" && ship.auto_target_colony_id) {
      const colony = colonyList.find((c) => c.id === ship.auto_target_colony_id);
      if (colony) {
        autoTargetNameByShipId.set(ship.id, systemDisplayName(colony.system_id));
      }
    }
  }

  // ── Per-colony display data ───────────────────────────────────────────────
  const colonyDisplayData = colonyList.map((colony) => {
    const health = colonyHealthStatus(colony.upkeep_missed_periods);

    const rawAccrued =
      colony.status === "active"
        ? calculateAccumulatedTax(
            colony.last_tax_collected_at,
            colony.population_tier,
            requestTime,
          )
        : 0;
    // Apply health tax multiplier for display (matches what collect will give).
    const accrued = Math.floor(rawAccrued * taxMultiplier(colony.upkeep_missed_periods));

    const survey = surveyByBodyId.get(colony.body_id) ?? null;
    const rawExtraction: ExtractionAmount[] =
      survey && colony.last_extract_at && colony.status === "active"
        ? calculateAccumulatedExtraction(
            survey.resource_nodes,
            colony.population_tier,
            colony.last_extract_at,
            requestTime,
          )
        : [];
    // Apply health extraction multiplier for display (matches what extract will give).
    const extMult = extractionMultiplier(colony.upkeep_missed_periods);
    const accruedExtraction: ExtractionAmount[] = rawExtraction
      .map((item) => ({ ...item, quantity: Math.floor(item.quantity * extMult) }))
      .filter((item) => item.quantity > 0);

    return { colony, accrued, accruedExtraction, health };
  });

  const totalAccrued = colonyDisplayData.reduce((s, d) => s + d.accrued, 0);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Command Centre</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Welcome back, {player.handle}.
          </p>
        </div>
        <Link
          href="/game/research"
          className="shrink-0 rounded-lg border border-indigo-800 bg-indigo-950/50 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-900/50 hover:text-indigo-200 transition-colors"
        >
          Research Lab →
        </Link>
      </div>

      {/* Status grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Location */}
        <div className="rounded-lg border border-indigo-900 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Current location
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold text-indigo-300 truncate">
            {isAnyInTransit && bannerJob
              ? systemDisplayName(bannerJob.to_system_id)
              : currentSystemId
                ? systemDisplayName(currentSystemId)
                : "Unknown"}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {isAnyInTransit && etaDisplay ? (
              etaDisplay
            ) : currentSystemId ? (
              <Link
                href={`/game/system/${encodeURIComponent(currentSystemId)}`}
                className="text-indigo-500 hover:text-indigo-400"
              >
                View system →
              </Link>
            ) : (
              "Position unknown"
            )}
          </p>
        </div>

        {/* Credits */}
        <div className="rounded-lg border border-amber-900 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Credits
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold text-amber-300">
            {player.credits.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {totalAccrued > 0
              ? `${totalAccrued} ¢ accrued — collect below`
              : activeColonyCount > 0
                ? "Taxes accruing — check colonies below"
                : "Found a colony to start earning"}
          </p>
        </div>

        {/* Colonies */}
        <div className="rounded-lg border border-emerald-900 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Active colonies
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold text-emerald-300">
            {activeColonyCount}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {player.colony_slots} slot
            {player.colony_slots !== 1 ? "s" : ""} available
          </p>
        </div>
      </div>

      {/* In-transit banner (manual ships only; auto ships show state in ShipRow) */}
      {isAnyInTransit && bannerJob && activeTravelJob?.ship_id &&
        resolvedShipList.find((s) => s.id === activeTravelJob.ship_id)?.dispatch_mode === "manual" && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/70 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-300">
              <span className="text-zinc-500">In transit →</span>{" "}
              <Link
                href={`/game/system/${encodeURIComponent(bannerJob.to_system_id)}`}
                className="text-indigo-400 hover:text-indigo-300 font-medium"
              >
                {systemDisplayName(bannerJob.to_system_id)}
              </Link>
            </p>
            {etaDisplay && (
              <p className="text-xs text-zinc-500 mt-0.5">{etaDisplay}</p>
            )}
          </div>
          <Link
            href={`/game/system/${encodeURIComponent(bannerJob.to_system_id)}`}
            className="shrink-0 rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 transition-colors"
          >
            Go to system
          </Link>
        </div>
      )}

      {/* Core station */}
      {station && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Core Station
          </h2>
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  {station.name}
                </p>
                <p className="text-xs text-zinc-500">
                  {systemDisplayName(station.current_system_id)} ·{" "}
                  <span className="text-zinc-600">stationary (alpha)</span>
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                Hub
              </span>
            </div>

            {stationInventory.length > 0 ? (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <p className="mb-1.5 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Station inventory
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {stationInventory.map((row) => (
                    <span key={row.resource_type} className="text-xs text-zinc-400">
                      {row.resource_type}{" "}
                      <span className="font-mono text-zinc-300">
                        ×{row.quantity.toLocaleString()}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-zinc-600">
                Inventory empty — extract and haul resources to fill it.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Ships */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Ships
        </h2>
        {resolvedShipList.length === 0 ? (
          <EmptyState message="No ships found. Try refreshing or signing out and back in." />
        ) : (
          <div className="space-y-2">
            {resolvedShipList.map((ship) => (
              <ShipRow
                key={ship.id}
                ship={ship}
                job={travelJobByShipId.get(ship.id) ?? null}
                cargo={cargoByShipId.get(ship.id) ?? []}
                stationSystemId={station?.current_system_id ?? null}
                autoTargetSystemName={autoTargetNameByShipId.get(ship.id) ?? null}
                upgradeSummary={upgradeByShipId.get(ship.id) ?? null}
                stationIron={stationIronForUpgrades}
              />
            ))}
          </div>
        )}
      </section>

      {/* Colonies */}
      {colonyList.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Colonies
          </h2>
          <div className="space-y-2">
            {colonyDisplayData.map(({ colony, accrued, accruedExtraction, health }) => (
              <ColonyRow
                key={colony.id}
                colony={colony}
                accrued={accrued}
                accruedExtraction={accruedExtraction}
                health={health}
              />
            ))}
          </div>
        </section>
      )}

      {/* Nearby systems */}
      {nearbySystems.length > 0 && dockedSystemId && (
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
                <p className="text-sm font-medium text-zinc-200">{nearby.name}</p>
                <span className="font-mono text-xs text-zinc-500">
                  {nearby.distanceFromSource.toFixed(2)} ly
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Getting started */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">
          Getting started
        </h2>
        <ol className="space-y-1 text-sm text-zinc-500">
          <li>
            <span className="text-zinc-400">1.</span> Travel to a nearby system
            within {BALANCE.lanes.baseRangeLy} ly and discover it.
          </li>
          <li>
            <span className="text-zinc-400">2.</span> Survey a body to reveal
            its resources and colony suitability.
          </li>
          <li>
            <span className="text-zinc-400">3.</span> Found a colony on a
            habitable world — your first colony is free.
          </li>
          <li>
            <span className="text-zinc-400">4.</span> Extract resources from
            colonies into colony inventory.
          </li>
          <li>
            <span className="text-zinc-400">5.</span> Load ship cargo and return
            to Sol to unload into your station — or set a ship to auto mode.
          </li>
        </ol>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ShipRow({
  ship,
  job,
  cargo,
  stationSystemId,
  autoTargetSystemName,
  upgradeSummary,
  stationIron,
}: {
  ship: Ship;
  job: TravelJob | null;
  cargo: { resource_type: string; quantity: number }[];
  stationSystemId: string | null;
  autoTargetSystemName: string | null;
  upgradeSummary: ShipUpgradeSummary | null;
  stationIron: number;
}) {
  const isThisShipInTransit = !ship.current_system_id && job !== null;
  const isAuto = ship.dispatch_mode !== "manual";

  let locationDisplay: string;
  if (isThisShipInTransit && job) {
    locationDisplay = `En route → ${systemDisplayName(job.to_system_id)}`;
  } else if (ship.current_system_id) {
    locationDisplay = systemDisplayName(ship.current_system_id);
  } else {
    locationDisplay = "In transit";
  }

  const systemHref =
    isThisShipInTransit && job
      ? `/game/system/${encodeURIComponent(job.to_system_id)}`
      : ship.current_system_id
        ? `/game/system/${encodeURIComponent(ship.current_system_id)}`
        : null;

  const cargoUsed = cargo.reduce((s, r) => s + r.quantity, 0);
  const cargoSummary = cargo.map((r) => `${r.quantity} ${r.resource_type}`).join(", ");

  const canUnload =
    ship.dispatch_mode === "manual" &&
    !!ship.current_system_id &&
    stationSystemId !== null &&
    ship.current_system_id === stationSystemId &&
    cargo.length > 0;

  // ETA from job
  let etaText: string | null = null;
  if (isThisShipInTransit && job) {
    const remainingMs = Math.max(0, new Date(job.arrive_at).getTime() - Date.now());
    const remainingMin = Math.ceil(remainingMs / 60_000);
    etaText =
      remainingMin <= 0
        ? "Arriving…"
        : remainingMin < 60
          ? `~${remainingMin} min`
          : `~${(remainingMin / 60).toFixed(1)} hr`;
  }

  const tier = upgradeSummary?.tier ?? 1;
  const totalUpgrades = upgradeSummary?.totalUpgrades ?? 0;
  const maxTotal = upgradeSummary?.maxTotalUpgrades ?? 6;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      {/* ── Header row ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-zinc-200">{ship.name}</p>
            {/* Ship tier badge */}
            <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
              T{tier}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            {systemHref ? (
              <Link href={systemHref} className="hover:text-zinc-300 transition-colors">
                {locationDisplay}
              </Link>
            ) : (
              locationDisplay
            )}
            {etaText && (
              <span className="ml-2 text-zinc-600">{etaText}</span>
            )}
          </p>
          {/* Auto-ship task label */}
          {isAuto && (
            <p className="mt-0.5 text-xs text-indigo-400">
              {autoStateLabel(ship.auto_state, autoTargetSystemName ?? undefined)}
            </p>
          )}
        </div>
        <div className="text-right shrink-0 space-y-1">
          <p className="text-xs text-zinc-500">
            {ship.speed_ly_per_hr} ly/hr · {cargoUsed}/{ship.cargo_cap} cargo
          </p>
          {/* Mode selector */}
          <ShipModeSelector shipId={ship.id} currentMode={ship.dispatch_mode} />
        </div>
      </div>

      {/* Cargo contents */}
      {cargo.length > 0 && (
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <p className="text-xs text-zinc-500 mb-1">
            Cargo: <span className="text-zinc-400">{cargoSummary}</span>
          </p>
          {canUnload && (
            <UnloadButton shipId={ship.id} summary={cargoSummary} />
          )}
        </div>
      )}

      {/* ── Upgrade panel ─────────────────────────────────────────────────── */}
      {upgradeSummary && (
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Ship Upgrades
            </p>
            <p className="text-xs text-zinc-600">
              {totalUpgrades}/{maxTotal} used · T{tier}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {SHIP_STAT_KEYS.map((stat) => {
              const s = upgradeSummary.stats[stat];
              const canAfford = stationIron >= s.ironCost;
              const showButton = s.canUpgrade;
              const buttonAffordable = showButton && canAfford;

              // Effective value label for wired stats
              let valueLabel = "";
              if (stat === "cargo") {
                valueLabel = ` · cap ${upgradeSummary.effectiveCargoCap}`;
              } else if (stat === "engine") {
                valueLabel = ` · ${upgradeSummary.effectiveSpeed} ly/hr`;
              }

              // Reason for locked
              let lockedReason = "";
              if (s.isAtStatCap && s.researchCap < 10) {
                lockedReason = `Research cap (${s.researchCap})`;
              } else if (s.isAtStatCap) {
                lockedReason = "Max";
              } else if (s.isAtTotalCap) {
                lockedReason = "Ship at limit";
              }

              return (
                <div key={stat} className="flex items-center justify-between gap-1 min-w-0">
                  <span className="text-xs text-zinc-500 shrink-0">
                    {SHIP_STAT_LABELS[stat]}{" "}
                    <span className="font-mono text-zinc-300">Lv {s.currentLevel}</span>
                    <span className="text-zinc-600">{valueLabel}</span>
                  </span>
                  <span className="shrink-0">
                    {showButton ? (
                      buttonAffordable ? (
                        <UpgradeButton
                          shipId={ship.id}
                          stat={stat}
                          ironCost={s.ironCost}
                        />
                      ) : (
                        <span className="text-xs text-zinc-700" title={`Need ${s.ironCost} iron`}>
                          ↑ {s.ironCost}⛏
                        </span>
                      )
                    ) : (
                      lockedReason ? (
                        <span className="text-xs text-zinc-700">{lockedReason}</span>
                      ) : null
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {stationIron > 0 && (
            <p className="mt-1.5 text-xs text-zinc-700">
              Station iron: <span className="font-mono text-zinc-500">{stationIron.toLocaleString()}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ColonyRow({
  colony,
  accrued,
  accruedExtraction,
  health,
}: {
  colony: Colony;
  accrued: number;
  accruedExtraction: ExtractionAmount[];
  health: ColonyHealthStatus;
}) {
  const systemName = systemDisplayName(colony.system_id);
  const bodyIndex = colony.body_id.slice(colony.body_id.lastIndexOf(":") + 1);

  const statusColor: Record<Colony["status"], string> = {
    active: "text-emerald-400",
    abandoned: "text-amber-400",
    collapsed: "text-zinc-600",
  };

  let growthLabel: string | null = null;
  if (colony.status === "active") {
    if (!colony.next_growth_at) {
      growthLabel = "Max tier";
    } else if (colony.upkeep_missed_periods >= 1) {
      growthLabel = "growth paused";
    } else {
      const growthDate = new Date(colony.next_growth_at);
      growthLabel = `grows ${growthDate > new Date() ? growthDate.toLocaleDateString() : "soon"}`;
    }
  }

  const extractSummary = formatExtractionSummary(accruedExtraction);

  const healthBadge: Record<ColonyHealthStatus, { label: string; classes: string }> = {
    well_supplied: { label: "Supplied", classes: "bg-emerald-900/50 text-emerald-400" },
    struggling: { label: "Struggling", classes: "bg-amber-900/50 text-amber-400" },
    neglected: { label: "Neglected", classes: "bg-red-900/50 text-red-400" },
  };
  const badge = healthBadge[health];

  return (
    <div className={`rounded-lg border bg-zinc-900 px-4 py-3 ${
      health === "neglected"
        ? "border-red-900"
        : health === "struggling"
          ? "border-amber-900"
          : "border-zinc-800"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-zinc-200 truncate">
              <Link
                href={`/game/system/${encodeURIComponent(colony.system_id)}`}
                className="hover:text-zinc-100 transition-colors"
              >
                {systemName}
              </Link>
              <span className="ml-1.5 text-xs text-zinc-600">· Body {bodyIndex}</span>
            </p>
            {colony.status === "active" && health !== "well_supplied" && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${badge.classes}`}>
                {badge.label}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            Tier {colony.population_tier}{" "}
            <span className={`font-medium ${statusColor[colony.status]}`}>
              {colony.status}
            </span>
            {growthLabel && (
              <span className={`ml-2 ${colony.upkeep_missed_periods >= 1 ? "text-amber-600" : "text-zinc-600"}`}>
                · {growthLabel}
              </span>
            )}
          </p>
          {colony.status === "active" && health !== "well_supplied" && (
            <p className="mt-0.5 text-xs text-red-500">
              {health === "neglected"
                ? `Neglected ${colony.upkeep_missed_periods} periods — send iron to station!`
                : "Low iron supply — yields reduced · send iron to station"}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right space-y-1.5">
          {/* Tax */}
          {colony.status === "active" && (
            <div>
              <p className="text-xs text-zinc-500">
                {accrued > 0 ? (
                  <span className="text-amber-300 font-medium">{accrued} ¢ accrued</span>
                ) : (
                  <span className="text-zinc-600">
                    {BALANCE.colony.taxPerHourByTier[colony.population_tier]} ¢/hr
                  </span>
                )}
              </p>
              {accrued > 0 && (
                <CollectButton colonyId={colony.id} accrued={accrued} />
              )}
            </div>
          )}

          {/* Extraction */}
          {colony.status === "active" && extractSummary && (
            <div>
              <p className="text-xs text-teal-300 font-medium">{extractSummary} ready</p>
              <ExtractButton colonyId={colony.id} summary={extractSummary} />
            </div>
          )}
        </div>
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
