/**
 * POST /api/game/ship/upgrade
 *
 * Upgrades one stat on a player's ship by one level.
 *
 * Validation order:
 *   1. Auth
 *   2. Input validation (shipId UUID, stat is a valid ShipStatKey)
 *   3. Player owns the ship
 *   4. Fetch player research → compute per-ship caps
 *   5. Not at per-stat research cap
 *   6. Not at per-ship total research cap
 *   7. Not at absolute DB max (10)
 *   8. Fetch station → station inventory
 *   9. Sufficient iron for cost (ceil(ironCostBase[stat] × 1.8^targetLevel))
 *  10. Deduct iron from station inventory
 *  11. Persist: increment stat_level, update derived stat column if applicable
 *
 * Derived stat updates (wired in Phase 11):
 *   cargo_level  → cargo_cap  = BASE + level × cargoCapPerLevel
 *   engine_level → speed_ly_per_hr = BASE + level × speedPerLevel
 *
 * Scaffold stats (hull, shield, turret, utility) have no derived column yet.
 *
 * Body:   { shipId: string, stat: "hull"|"shield"|"cargo"|"engine"|"turret"|"utility" }
 * Returns: { ok: true, data: { shipId, stat, newLevel, newCargoCap?, newSpeed? } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { upgradeIronCost, effectiveCargoCap, effectiveSpeed } from "@/lib/game/shipUpgrades";
import { maxTotalShipUpgrades, maxStatLevel } from "@/lib/game/researchHelpers";
import { shipTotalUpgrades } from "@/lib/game/shipUpgrades";
import type { Ship, PlayerResearch, PlayerStation, ResourceInventoryRow } from "@/lib/types/game";
import type { ShipStatKey } from "@/lib/config/research";

const UpgradeSchema = z.object({
  shipId: z.string().uuid(),
  stat: z.enum(["hull", "shield", "cargo", "engine", "turret", "utility"]),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(UpgradeSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { shipId, stat } = input.data;

  const admin = createAdminClient();

  // ── Fetch ship ────────────────────────────────────────────────────────────
  const { data: ship } = maybeSingleResult<Ship>(
    await admin
      .from("ships")
      .select("id, owner_id, hull_level, shield_level, cargo_level, engine_level, turret_level, utility_level, cargo_cap, speed_ly_per_hr")
      .eq("id", shipId)
      .maybeSingle(),
  );

  if (!ship) {
    return toErrorResponse(fail("not_found", "Ship not found.").error);
  }

  if (ship.owner_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You do not own this ship.").error);
  }

  // ── Fetch player research ──────────────────────────────────────────────────
  const { data: researchRows } = listResult<Pick<PlayerResearch, "research_id">>(
    await admin
      .from("player_research")
      .select("research_id")
      .eq("player_id", player.id),
  );
  const unlockedIds = new Set((researchRows ?? []).map((r) => r.research_id));

  // ── Check upgrade caps ────────────────────────────────────────────────────
  const currentLevel = ship[`${stat}_level` as keyof typeof ship] as number;
  const targetLevel = currentLevel + 1;

  const researchStatCap = maxStatLevel(stat as ShipStatKey, unlockedIds);
  if (currentLevel >= researchStatCap) {
    return toErrorResponse(
      fail(
        "capacity_exceeded",
        `${stat} is already at the research cap (level ${researchStatCap}). Unlock higher research to continue.`,
      ).error,
    );
  }

  if (currentLevel >= 10) {
    return toErrorResponse(
      fail("capacity_exceeded", `${stat} is already at the maximum level (10).`).error,
    );
  }

  const totalUpgrades = shipTotalUpgrades(ship as Pick<Ship,
    "hull_level" | "shield_level" | "cargo_level" |
    "engine_level" | "turret_level" | "utility_level"
  >);
  const maxTotal = maxTotalShipUpgrades(unlockedIds);
  if (totalUpgrades >= maxTotal) {
    return toErrorResponse(
      fail(
        "capacity_exceeded",
        `This ship has reached its upgrade limit (${maxTotal} total). Unlock Tier ${
          maxTotal < 11 ? "2" : maxTotal < 23 ? "3" : maxTotal < 59 ? "4" : "5"
        } Hulls to expand it.`,
      ).error,
    );
  }

  // ── Compute iron cost ─────────────────────────────────────────────────────
  const ironCost = upgradeIronCost(stat as ShipStatKey, targetLevel);

  // ── Fetch station + inventory ─────────────────────────────────────────────
  const { data: station } = maybeSingleResult<PlayerStation>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("player_stations")
      .select("id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );

  if (!station) {
    return toErrorResponse(fail("not_found", "Station not found — refresh the page to rebuild it automatically.").error);
  }

  const { data: invRow } = maybeSingleResult<Pick<ResourceInventoryRow, "quantity">>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron")
      .maybeSingle(),
  );

  const currentIron = invRow?.quantity ?? 0;
  if (currentIron < ironCost) {
    return toErrorResponse(
      fail(
        "insufficient_resources",
        `Not enough iron. Need ${ironCost}, have ${currentIron}.`,
      ).error,
    );
  }

  // ── Deduct iron ───────────────────────────────────────────────────────────
  const remainingIron = currentIron - ironCost;
  if (remainingIron === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("resource_inventory")
      .delete()
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron");
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("resource_inventory")
      .update({ quantity: remainingIron })
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron");
  }

  // ── Build ship update patch ───────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {
    [`${stat}_level`]: targetLevel,
  };

  // Wire derived stats for cargo and engine.
  let newCargoCap: number | undefined;
  let newSpeed: number | undefined;

  if (stat === "cargo") {
    newCargoCap = effectiveCargoCap(targetLevel);
    patch.cargo_cap = newCargoCap;
  } else if (stat === "engine") {
    newSpeed = effectiveSpeed(targetLevel);
    patch.speed_ly_per_hr = newSpeed;
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("ships")
    .update(patch)
    .eq("id", shipId);

  return Response.json({
    ok: true,
    data: {
      shipId,
      stat,
      newLevel: targetLevel,
      ...(newCargoCap !== undefined ? { newCargoCap } : {}),
      ...(newSpeed    !== undefined ? { newSpeed }    : {}),
    },
  });
}
