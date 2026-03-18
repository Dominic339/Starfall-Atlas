/**
 * Lane action: build a hyperspace lane between two systems.
 *
 * Implementation status: structure + validation complete.
 * DB transaction TODO(phase-7).
 */

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, parseInput } from "./helpers";
import { ok, fail, type ActionResult } from "./types";
import { BALANCE } from "@/lib/config/balance";
import { generateSystem } from "@/lib/game/generation";
import { isWithinLaneRange, distanceBetween } from "@/lib/game/travel";
import type { BuildLaneResult } from "@/lib/types/api";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const buildLaneSchema = z.object({
  fromSystemId: z.string().min(1),
  toSystemId: z.string().min(1),
  accessLevel: z.enum(["public", "alliance_only", "private"]),
  transitTaxRate: z
    .number()
    .int()
    .min(0)
    .max(BALANCE.lanes.maxTransitTaxPercent),
  allianceId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/**
 * Queue construction of a hyperspace lane.
 *
 * Preconditions:
 * - Player owns at least one of the two endpoint systems.
 * - Distance between systems is within lane range (accounting for relays).
 * - No existing lane between these two systems.
 *
 * TODO(phase-7): Deduct resource/credit cost and insert lane + job in transaction.
 */
export async function buildLane(
  rawInput: unknown,
): Promise<ActionResult<BuildLaneResult>> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;
  const { player } = authResult.data;

  const inputResult = parseInput(buildLaneSchema, rawInput);
  if (!inputResult.ok) return inputResult;
  const input = inputResult.data;

  if (input.fromSystemId === input.toSystemId) {
    return fail("validation_error", "Cannot build a lane to the same system.");
  }

  if (input.accessLevel === "alliance_only" && !input.allianceId) {
    return fail(
      "validation_error",
      "allianceId is required for alliance_only lanes.",
    );
  }

  const admin = createAdminClient();

  // Verify player owns at least one endpoint
  const { data: ownership } = await admin
    .from("system_ownership")
    .select("system_id")
    .eq("owner_id", player.id)
    .in("system_id", [input.fromSystemId, input.toSystemId]);

  if (!ownership || ownership.length === 0) {
    return fail(
      "forbidden",
      "You must own at least one of the two endpoint systems to build a lane.",
    );
  }

  // Check range (deterministic world data — no DB needed)
  const fromSystem = generateSystem(input.fromSystemId);
  const toSystem = generateSystem(input.toSystemId);
  const distanceLy = distanceBetween(fromSystem.positionLy, toSystem.positionLy);

  // TODO(phase-7): Query relay station tiers from DB for both endpoints.
  const relayTierA = 0;
  const relayTierB = 0;

  if (!isWithinLaneRange(distanceLy, relayTierA, relayTierB)) {
    return fail(
      "lane_out_of_range",
      `Distance (${distanceLy.toFixed(1)} ly) exceeds lane range. ` +
        `Build Relay Stations to extend range.`,
    );
  }

  // Check no duplicate lane
  const { data: existingLane } = await admin
    .from("hyperspace_lanes")
    .select("id")
    .eq("from_system_id", input.fromSystemId)
    .eq("to_system_id", input.toSystemId)
    .maybeSingle();

  if (existingLane) {
    return fail("already_exists", "A lane already exists between these systems.");
  }

  // TODO(phase-7): Deduct costs and insert lane + construction_job in transaction.
  return fail(
    "not_implemented",
    "Lane construction not yet implemented. Coming in Phase 7.",
  );
}
