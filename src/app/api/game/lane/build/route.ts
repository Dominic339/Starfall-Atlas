/**
 * POST /api/game/lane/build
 *
 * Initiates hyperspace lane construction between two gated systems.
 *
 * Rules:
 *   1. fromSystemId must have an active gate owned by the player.
 *   2. toSystemId must have an active gate (any owner).
 *   3. Player's ship or station must be present in fromSystemId.
 *   4. No existing active or pending lane between these two systems.
 *   5. Distance must be ≤ baseRangeLy + relay extensions at each endpoint.
 *
 * Construction takes BALANCE.lanes.constructionHours (12h) and is resolved
 * lazily via gateResolution.resolveLaneJobs on subsequent page loads.
 *
 * Body: { fromSystemId: string, toSystemId: string }
 * Returns: { ok: true, data: { lane, completeAt: string } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { distanceBetween, isWithinLaneRange } from "@/lib/game/travel";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";
import { BALANCE } from "@/lib/config/balance";
import type { HyperspaceGate, HyperspaceLane, Ship, PlayerStation } from "@/lib/types/game";

const BuildLaneSchema = z.object({
  fromSystemId: z.string().min(1).max(64),
  toSystemId:   z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(BuildLaneSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { fromSystemId, toSystemId } = input.data;

  if (fromSystemId === toSystemId) {
    return toErrorResponse(fail("validation_error", "Cannot build a lane to the same system.").error);
  }
  if (fromSystemId === SOL_SYSTEM_ID || toSystemId === SOL_SYSTEM_ID) {
    return toErrorResponse(fail("forbidden", "Sol does not support hyperspace gates or lanes.").error);
  }

  const fromEntry = getCatalogEntry(fromSystemId);
  const toEntry   = getCatalogEntry(toSystemId);
  if (!fromEntry) return toErrorResponse(fail("not_found", `System '${fromSystemId}' not found.`).error);
  if (!toEntry)   return toErrorResponse(fail("not_found", `System '${toSystemId}' not found.`).error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now   = new Date();

  // ── Presence check ────────────────────────────────────────────────────────
  const [{ data: shipRows }, { data: stationRow }] = await Promise.all([
    listResult<Pick<Ship, "current_system_id">>(
      await admin.from("ships").select("current_system_id").eq("owner_id", player.id),
    ),
    maybeSingleResult<Pick<PlayerStation, "current_system_id">>(
      await admin.from("player_stations").select("current_system_id").eq("owner_id", player.id).maybeSingle(),
    ),
  ]);

  const shipPresent    = (shipRows ?? []).some((s) => s.current_system_id === fromSystemId);
  const stationPresent = stationRow?.current_system_id === fromSystemId;

  if (!shipPresent && !stationPresent) {
    return toErrorResponse(
      fail("invalid_target", "Your ship or station must be in the source system to build a lane.").error,
    );
  }

  // ── Gate checks ───────────────────────────────────────────────────────────
  const [{ data: fromGateRow }, { data: toGateRow }] = await Promise.all([
    maybeSingleResult<HyperspaceGate>(
      await admin.from("hyperspace_gates").select("*").eq("system_id", fromSystemId).maybeSingle(),
    ),
    maybeSingleResult<HyperspaceGate>(
      await admin.from("hyperspace_gates").select("*").eq("system_id", toSystemId).maybeSingle(),
    ),
  ]);

  if (!fromGateRow || fromGateRow.status !== "active") {
    return toErrorResponse(fail("invalid_target", "The source system does not have an active gate.").error);
  }
  if (fromGateRow.owner_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You must own the active gate at the source system.").error);
  }
  if (!toGateRow || toGateRow.status !== "active") {
    return toErrorResponse(fail("invalid_target", "The destination system does not have an active gate.").error);
  }

  // ── Distance check ────────────────────────────────────────────────────────
  const distLy = distanceBetween(
    { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
    { x: toEntry.x,   y: toEntry.y,   z: toEntry.z   },
  );

  // TODO: read relay_station tiers from DB for dynamic range extension
  const inRange = isWithinLaneRange(distLy, 0, 0);
  if (!inRange) {
    return toErrorResponse(
      fail(
        "lane_out_of_range",
        `${toEntry.properName ?? toSystemId} is ${distLy.toFixed(2)} ly away. ` +
        `Max lane range is ${BALANCE.lanes.baseRangeLy} ly (build relay stations to extend).`,
      ).error,
    );
  }

  // ── Duplicate lane check (both directions) ────────────────────────────────
  const { data: existingLanes } = await admin
    .from("hyperspace_lanes")
    .select("id, is_active")
    .or(
      `and(from_system_id.eq.${fromSystemId},to_system_id.eq.${toSystemId}),` +
      `and(from_system_id.eq.${toSystemId},to_system_id.eq.${fromSystemId})`,
    );

  if (existingLanes && existingLanes.length > 0) {
    const active = existingLanes.find((l: HyperspaceLane) => l.is_active);
    if (active) {
      return toErrorResponse(fail("already_exists", "An active lane already exists between these systems.").error);
    }
    // Pending lane — return current status
    const pending = existingLanes[0] as HyperspaceLane;
    const { data: jobRow } = maybeSingleResult<{ complete_at: string }>(
      await admin
        .from("lane_construction_jobs")
        .select("complete_at")
        .eq("lane_id", pending.id)
        .eq("status", "pending")
        .maybeSingle(),
    );
    return Response.json({ ok: true, data: { lane: pending, completeAt: jobRow?.complete_at ?? null } });
  }

  // ── Create lane + job ─────────────────────────────────────────────────────
  const completeAt = new Date(now.getTime() + BALANCE.lanes.constructionHours * 60 * 60 * 1000);

  const { data: lane } = maybeSingleResult<HyperspaceLane>(
    await admin
      .from("hyperspace_lanes")
      .insert({
        owner_id:         player.id,
        from_system_id:   fromSystemId,
        to_system_id:     toSystemId,
        from_gate_id:     fromGateRow.id,
        to_gate_id:       toGateRow.id,
        access_level:     "public",
        transit_tax_rate: 0,
        is_active:        false,
      })
      .select("*")
      .maybeSingle(),
  );

  if (!lane) {
    return toErrorResponse(fail("internal_error", "Failed to create lane record.").error);
  }

  await admin.from("lane_construction_jobs").insert({
    lane_id:     lane.id,
    player_id:   player.id,
    started_at:  now.toISOString(),
    complete_at: completeAt.toISOString(),
    status:      "pending",
  });

  return Response.json({ ok: true, data: { lane, completeAt: completeAt.toISOString() } });
}
