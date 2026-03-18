/**
 * POST /api/game/colony/found
 *
 * Founds a new colony on a surveyed, eligible body.
 *
 * Rules (Phase 5):
 *   1. Authenticated player.
 *   2. Player's ship is physically present in the body's system.
 *   3. System discovered by player — Sol is exempt (canonical home).
 *   4. Body has a survey result (any player's survey counts).
 *   5. Body is eligible: habitabilityScore >= 60 (canHostColony = true).
 *   6. Body is not already occupied (no active or abandoned colony).
 *   7. Player has a colony slot available (colony_slots > active colonies).
 *
 * Cost:
 *   - Phase 5: zero credits for ALL colony founding.
 *     The "first colony is free" rule is the permanent rule; subsequent
 *     colonies will cost resources in a later phase (not credits).
 *     TODO(phase-6): charge resource costs for non-first colonies.
 *
 * Body: { bodyId: string }   e.g. "hyg:70890:0"
 * Returns: { ok: true, data: { colony: Colony, isFirst: boolean } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  parseInput,
  requireColonySlot,
  toErrorResponse,
} from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult, maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import { nextGrowthAt } from "@/lib/game/taxes";
import { BALANCE } from "@/lib/config/balance";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";
import type { Ship, Colony, SystemDiscovery, Player } from "@/lib/types/game";

const FoundColonySchema = z.object({
  bodyId: z.string().min(1).max(128),
});

/** Split "systemId:bodyIndex" — system IDs may themselves contain colons. */
function parseBodyId(
  bodyId: string,
): { systemId: string; bodyIndex: number } | null {
  const lastColon = bodyId.lastIndexOf(":");
  if (lastColon === -1) return null;
  const systemId = bodyId.slice(0, lastColon);
  const indexStr = bodyId.slice(lastColon + 1);
  const bodyIndex = parseInt(indexStr, 10);
  if (!systemId || isNaN(bodyIndex) || bodyIndex < 0) return null;
  return { systemId, bodyIndex };
}

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(FoundColonySchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { bodyId } = input.data;

  // ── Parse body ID ─────────────────────────────────────────────────────────
  const parsed = parseBodyId(bodyId);
  if (!parsed) {
    return toErrorResponse(
      fail(
        "validation_error",
        "Invalid bodyId format. Expected '{systemId}:{bodyIndex}', e.g. 'hyg:70890:0'.",
      ).error,
    );
  }
  const { systemId, bodyIndex } = parsed;

  // ── Sol protection (GAME_RULES.md §1.1 and §4.1) ─────────────────────────
  // Sol is a protected shared starter system. Its bodies are never colonizable.
  // This is an absolute server-side invariant — no premium item or governance
  // status can override it.
  if (systemId === SOL_SYSTEM_ID) {
    return toErrorResponse(
      fail(
        "forbidden",
        "Sol is a protected shared starter system. Its bodies cannot be colonized.",
      ).error,
    );
  }

  // ── Catalog check ─────────────────────────────────────────────────────────
  const catalogEntry = getCatalogEntry(systemId);
  if (!catalogEntry) {
    return toErrorResponse(
      fail("not_found", `System '${systemId}' is not in the catalog.`).error,
    );
  }

  const admin = createAdminClient();

  // ── Ship presence check ───────────────────────────────────────────────────
  const { data: ship } = singleResult<Ship>(
    await admin
      .from("ships")
      .select("current_system_id")
      .eq("owner_id", player.id)
      .single(),
  );

  if (!ship?.current_system_id || ship.current_system_id !== systemId) {
    return toErrorResponse(
      fail(
        "invalid_target",
        "Your ship must be physically present in the system to found a colony.",
      ).error,
    );
  }

  // ── Discovery check (Sol exempt) ─────────────────────────────────────────
  if (systemId !== SOL_SYSTEM_ID) {
    const { data: discovery } = maybeSingleResult<SystemDiscovery>(
      await admin
        .from("system_discoveries")
        .select("id")
        .eq("system_id", systemId)
        .eq("player_id", player.id)
        .maybeSingle(),
    );

    if (!discovery) {
      return toErrorResponse(
        fail(
          "invalid_target",
          "You must discover this system before founding a colony here.",
        ).error,
      );
    }
  }

  // ── Survey check ─────────────────────────────────────────────────────────
  const { data: surveyResult } = maybeSingleResult<{ id: string }>(
    await admin
      .from("survey_results")
      .select("id")
      .eq("body_id", bodyId)
      .maybeSingle(),
  );

  if (!surveyResult) {
    return toErrorResponse(
      fail(
        "invalid_target",
        "This body has not been surveyed. Survey it before founding a colony.",
      ).error,
    );
  }

  // ── Body eligibility check ────────────────────────────────────────────────
  const generatedSystem = generateSystem(systemId, catalogEntry);
  const generatedBody = generatedSystem.bodies[bodyIndex];

  if (!generatedBody) {
    return toErrorResponse(
      fail(
        "not_found",
        `Body index ${bodyIndex} does not exist in system '${systemId}'.`,
      ).error,
    );
  }

  if (!generatedBody.canHostColony) {
    return toErrorResponse(
      fail(
        "invalid_target",
        `This body (habitability ${generatedBody.habitabilityScore}/100) cannot host a standard colony. ` +
          "A score of 60 or higher is required.",
      ).error,
    );
  }

  // ── Occupation check ──────────────────────────────────────────────────────
  // A body with an active or abandoned colony cannot be claimed again.
  // A collapsed colony body is available.
  const { data: existingColony } = maybeSingleResult<{
    id: string;
    status: string;
  }>(
    await admin
      .from("colonies")
      .select("id, status")
      .eq("body_id", bodyId)
      .maybeSingle(),
  );

  if (existingColony && existingColony.status !== "collapsed") {
    return toErrorResponse(
      fail("already_exists", "This body already has an active colony.").error,
    );
  }

  // ── Colony slot check ─────────────────────────────────────────────────────
  const { data: playerColonies } = listResult<{ id: string }>(
    await admin
      .from("colonies")
      .select("id")
      .eq("owner_id", player.id)
      .eq("status", "active"),
  );
  const activeColonyCount = playerColonies?.length ?? 0;
  const slotCheck = requireColonySlot(player, activeColonyCount);
  if (!slotCheck.ok) return toErrorResponse(slotCheck.error);

  // ── Found the colony ──────────────────────────────────────────────────────
  // Phase 5: No credit or resource cost.
  // first_colony_placed flag is set on the player after the first insert.
  const isFirstColony = !player.first_colony_placed;
  const now = new Date();
  const growthAt = nextGrowthAt(1, now);

  const { data: colony } = maybeSingleResult<Colony>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("colonies")
      .insert({
        owner_id: player.id,
        system_id: systemId,
        body_id: bodyId,
        status: "active",
        population_tier: 1,
        next_growth_at: growthAt?.toISOString() ?? null,
        last_tax_collected_at: now.toISOString(),
        storage_cap: BALANCE.colony.defaultStorageCap,
      })
      .select("*")
      .maybeSingle(),
  );

  if (!colony) {
    // UNIQUE conflict on body_id — a concurrent request won the race.
    return toErrorResponse(
      fail(
        "already_exists",
        "This body was just claimed by another player.",
      ).error,
    );
  }

  // ── Mark first colony placed on player ────────────────────────────────────
  if (isFirstColony) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("players")
      .update({ first_colony_placed: true } as Partial<Player>)
      .eq("id", player.id);
  }

  // ── Emit world event (fire-and-forget) ────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void (admin as any).from("world_events").insert({
    event_type: "colony_founded",
    player_id: player.id,
    system_id: systemId,
    body_id: bodyId,
    metadata: {
      handle: player.handle,
      system_name: catalogEntry.properName,
      body_index: bodyIndex,
      is_first: isFirstColony,
    },
  });

  return Response.json({
    ok: true,
    data: { colony, isFirst: isFirstColony },
  });
}
