/**
 * POST /api/game/colony/route/update
 *
 * Updates mutable fields on an existing colony supply route.
 * Only the route owner may modify it.
 *
 * Mutable fields: resource_type, mode, fixed_amount, interval_minutes.
 * Changing interval_minutes is re-validated against round-trip travel time.
 *
 * Body:
 *   { routeId, resourceType?, mode?, fixedAmount?, intervalMinutes? }
 * Returns:
 *   { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { distanceBetween } from "@/lib/game/travel";
import { BALANCE } from "@/lib/config/balance";
import type { ColonyRoute, Colony } from "@/lib/types/game";

const UpdateRouteSchema = z.object({
  routeId:         z.string().uuid(),
  resourceType:    z.string().min(1).max(64).optional(),
  mode:            z.enum(["all", "excess", "fixed"]).optional(),
  fixedAmount:     z.number().int().min(1).optional(),
  intervalMinutes: z.number().int().min(1).max(43200).optional(),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(UpdateRouteSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { routeId, resourceType, mode, fixedAmount, intervalMinutes } = input.data;

  const admin = createAdminClient();

  // ── Fetch existing route ──────────────────────────────────────────────────
  const { data: route } = maybeSingleResult<ColonyRoute>(
    await admin
      .from("colony_routes")
      .select("*")
      .eq("id", routeId)
      .maybeSingle(),
  );

  if (!route) {
    return toErrorResponse(fail("not_found", "Route not found.").error);
  }
  if (route.player_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You do not own this route.").error);
  }

  // ── Resolve effective values ──────────────────────────────────────────────
  const effectiveMode = mode ?? route.mode;
  const effectiveInterval = intervalMinutes ?? route.interval_minutes;

  if (effectiveMode === "fixed") {
    const effectiveFixed = fixedAmount ?? route.fixed_amount;
    if (!effectiveFixed || effectiveFixed < 1) {
      return toErrorResponse(
        fail("validation_error", "fixed_amount is required when mode is 'fixed'.").error,
      );
    }
  }

  // ── Validate new interval vs round-trip if changed ────────────────────────
  if (intervalMinutes !== undefined) {
    // Fetch both colonies to compute travel time
    const { data: fromColony } = maybeSingleResult<Pick<Colony, "id" | "system_id">>(
      await admin
        .from("colonies")
        .select("id, system_id")
        .eq("id", route.from_colony_id)
        .maybeSingle(),
    );
    const { data: toColony } = maybeSingleResult<Pick<Colony, "id" | "system_id">>(
      await admin
        .from("colonies")
        .select("id, system_id")
        .eq("id", route.to_colony_id)
        .maybeSingle(),
    );

    let minInterval: number = BALANCE.colonyTransport.minIntervalMinutes;
    if (fromColony && toColony && fromColony.system_id !== toColony.system_id) {
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

    if (effectiveInterval < minInterval) {
      return toErrorResponse(
        fail(
          "validation_error",
          `Interval must be at least ${minInterval} minutes (round-trip travel time).`,
        ).error,
      );
    }
  }

  // ── Build update payload ──────────────────────────────────────────────────
  const updates: Record<string, unknown> = {};
  if (resourceType !== undefined) updates.resource_type = resourceType;
  if (mode !== undefined) updates.mode = mode;
  if (mode !== undefined || fixedAmount !== undefined) {
    updates.fixed_amount = effectiveMode === "fixed" ? (fixedAmount ?? route.fixed_amount) : null;
  }
  if (intervalMinutes !== undefined) updates.interval_minutes = intervalMinutes;

  if (Object.keys(updates).length === 0) {
    return Response.json({ ok: true }); // nothing to change
  }

  // ── Apply update ──────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("colony_routes")
    .update(updates)
    .eq("id", routeId);

  return Response.json({ ok: true });
}
