/**
 * POST /api/game/colony/route/create
 *
 * Creates a supply route between two player-owned colonies.
 * The route will be lazily resolved on dashboard load.
 *
 * Validation:
 *  - Player owns both colonies and both are active
 *  - Colonies are not the same
 *  - interval_minutes >= round-trip travel time (approx)
 *  - mode = 'fixed' requires fixed_amount > 0
 *
 * Body:
 *   { fromColonyId, toColonyId, resourceType, mode, fixedAmount?, intervalMinutes }
 * Returns:
 *   { ok: true, data: { routeId } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { distanceBetween } from "@/lib/game/travel";
import { BALANCE } from "@/lib/config/balance";
import type { Colony } from "@/lib/types/game";

const CreateRouteSchema = z.object({
  fromColonyId:    z.string().uuid(),
  toColonyId:      z.string().uuid(),
  resourceType:    z.string().min(1).max(64),
  mode:            z.enum(["all", "excess", "fixed"]),
  fixedAmount:     z.number().int().min(1).optional(),
  intervalMinutes: z.number().int().min(1).max(43200), // max 30 days
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(CreateRouteSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { fromColonyId, toColonyId, resourceType, mode, fixedAmount, intervalMinutes } = input.data;

  if (fromColonyId === toColonyId) {
    return toErrorResponse(fail("invalid_target", "Source and destination must be different colonies.").error);
  }

  if (mode === "fixed" && (!fixedAmount || fixedAmount < 1)) {
    return toErrorResponse(fail("validation_error", "fixed_amount is required for fixed mode.").error);
  }

  const admin = createAdminClient();

  // ── Fetch both colonies ───────────────────────────────────────────────────
  const { data: colonies } = listResult<Pick<Colony, "id" | "owner_id" | "status" | "system_id">>(
    await admin
      .from("colonies")
      .select("id, owner_id, status, system_id")
      .in("id", [fromColonyId, toColonyId]),
  );

  const fromColony = (colonies ?? []).find((c) => c.id === fromColonyId);
  const toColony   = (colonies ?? []).find((c) => c.id === toColonyId);

  if (!fromColony) {
    return toErrorResponse(fail("not_found", "Source colony not found.").error);
  }
  if (!toColony) {
    return toErrorResponse(fail("not_found", "Destination colony not found.").error);
  }
  if (fromColony.owner_id !== player.id || toColony.owner_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You must own both colonies.").error);
  }
  if (fromColony.status !== "active") {
    return toErrorResponse(fail("invalid_target", "Source colony must be active.").error);
  }
  if (toColony.status !== "active") {
    return toErrorResponse(fail("invalid_target", "Destination colony must be active.").error);
  }

  // ── Validate interval vs round-trip travel time ───────────────────────────
  let minInterval: number = BALANCE.colonyTransport.minIntervalMinutes;
  if (fromColony.system_id !== toColony.system_id) {
    const fromEntry = getCatalogEntry(fromColony.system_id);
    const toEntry   = getCatalogEntry(toColony.system_id);
    if (fromEntry && toEntry) {
      const dist = distanceBetween(
        { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
        { x: toEntry.x,   y: toEntry.y,   z: toEntry.z },
      );
      const roundTripMins = Math.ceil((2 * dist / BALANCE.colonyTransport.speedLyPerHr) * 60);
      minInterval = Math.max(minInterval, roundTripMins);
    }
  }

  if (intervalMinutes < minInterval) {
    return toErrorResponse(
      fail(
        "validation_error",
        `Interval must be at least ${minInterval} minutes (round-trip travel time).`,
      ).error,
    );
  }

  // ── Check duplicate route ─────────────────────────────────────────────────
  const { data: existing } = maybeSingleResult<{ id: string }>(
    await admin
      .from("colony_routes")
      .select("id")
      .eq("player_id", player.id)
      .eq("from_colony_id", fromColonyId)
      .eq("to_colony_id", toColonyId)
      .eq("resource_type", resourceType)
      .maybeSingle(),
  );

  if (existing) {
    return toErrorResponse(
      fail("already_exists", "A route for this resource already exists between these colonies.").error,
    );
  }

  // ── Insert route ──────────────────────────────────────────────────────────
  const { data: inserted } = maybeSingleResult<{ id: string }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("colony_routes")
      .insert({
        player_id:        player.id,
        from_colony_id:   fromColonyId,
        to_colony_id:     toColonyId,
        resource_type:    resourceType,
        mode,
        fixed_amount:     mode === "fixed" ? fixedAmount : null,
        interval_minutes: intervalMinutes,
        last_run_at:      new Date().toISOString(),
      })
      .select("id")
      .maybeSingle(),
  );

  if (!inserted) {
    return toErrorResponse(fail("internal_error", "Failed to create route.").error);
  }

  return Response.json({ ok: true, data: { routeId: inserted.id } });
}
