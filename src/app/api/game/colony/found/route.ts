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
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import { isHarshPlanetType } from "@/lib/game/habitability";
import { nextGrowthAt } from "@/lib/game/taxes";
import { BALANCE } from "@/lib/config/balance";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";
import type { Colony, Ship, SystemDiscovery, Player, PlayerStation } from "@/lib/types/game";

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
  // Either of the player's ships being present is sufficient.
  const { data: allShips } = listResult<Pick<Ship, "current_system_id">>(
    await admin
      .from("ships")
      .select("current_system_id")
      .eq("owner_id", player.id),
  );

  const shipPresent = (allShips ?? []).some(
    (s) => s.current_system_id === systemId,
  );

  if (!shipPresent) {
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

  // ── Phase 16: harsh planet colonization gate ─────────────────────────────
  // Volcanic and toxic worlds require explicit research before founding.
  // Even with research, they count as harsh colonies (iron dome maintenance).
  const isHarsh = isHarshPlanetType(generatedBody.type);

  if (isHarsh) {
    // Check player has harsh_colony_environment research unlocked.
    const { data: harshResearch } = maybeSingleResult<{ research_id: string }>(
      await admin
        .from("player_research")
        .select("research_id")
        .eq("player_id", player.id)
        .eq("research_id", "harsh_colony_environment")
        .maybeSingle(),
    );

    if (!harshResearch) {
      return toErrorResponse(
        fail(
          "forbidden",
          `This ${generatedBody.type} world requires 'Harsh Colony Environment' research to colonize. ` +
            "Unlock it in the Research Lab first (requires Sustainability I + 1 active colony).",
        ).error,
      );
    }
    // Harsh worlds bypass the standard habitability score check.
    // Their dome maintenance cost (iron) will apply each upkeep period.
  } else if (!generatedBody.canHostColony) {
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
  // A collapsed colony body is available for re-founding (UPDATE path below).
  // Use limit(1) instead of maybeSingle() to avoid throwing on multiple rows.
  const { data: existingColonyRows } = listResult<{ id: string; status: string }>(
    await admin
      .from("colonies")
      .select("id, status")
      .eq("body_id", bodyId)
      .limit(1),
  );
  const existingColony = existingColonyRows?.[0] ?? null;

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

  // ── Founding iron cost (Phase 28: skip for first colony) ─────────────────
  // First colony is free to ease new-player onboarding.
  // Subsequent colonies cost iron based on planet type.
  const isFirstColony = !player.first_colony_placed;

  let ironDeducted = 0;
  let stationIdForRefund: string | null = null;

  if (!isFirstColony) {
    const foundingCost =
      BALANCE.colony.foundingCostIronByType[generatedBody.type] ??
      BALANCE.colony.foundingCostIronDefault;

    if (foundingCost > 0) {
      // Look up player station
      const { data: station } = maybeSingleResult<Pick<PlayerStation, "id">>(
        await admin
          .from("player_stations")
          .select("id")
          .eq("owner_id", player.id)
          .maybeSingle(),
      );

      if (!station) {
        return toErrorResponse(
          fail(
            "not_found",
            "Your station could not be found. Refresh the page — bootstrap will create it automatically.",
          ).error,
        );
      }

      stationIdForRefund = station.id;

      const { data: ironRow } = maybeSingleResult<{ quantity: number }>(
        await admin
          .from("resource_inventory")
          .select("quantity")
          .eq("location_type", "station")
          .eq("location_id", station.id)
          .eq("resource_type", "iron")
          .maybeSingle(),
      );

      const ironAvailable = ironRow?.quantity ?? 0;
      if (ironAvailable < foundingCost) {
        return toErrorResponse(
          fail(
            "insufficient_resources",
            `Not enough iron to found a colony on this ${generatedBody.type} world. Need ${foundingCost}, have ${ironAvailable}.`,
          ).error,
        );
      }

      // Deduct iron upfront
      const newIron = ironAvailable - foundingCost;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adminAny = admin as any;
      if (newIron <= 0) {
        await adminAny
          .from("resource_inventory")
          .delete()
          .eq("location_type", "station")
          .eq("location_id", station.id)
          .eq("resource_type", "iron");
      } else {
        await adminAny
          .from("resource_inventory")
          .update({ quantity: newIron })
          .eq("location_type", "station")
          .eq("location_id", station.id)
          .eq("resource_type", "iron");
      }
      ironDeducted = foundingCost;
    }
  }
  const now = new Date();
  const growthAt = nextGrowthAt(1, now);

  const colonyFields = {
    owner_id: player.id,
    system_id: systemId,
    body_id: bodyId,
    status: "active",
    population_tier: 1,
    next_growth_at: growthAt?.toISOString() ?? null,
    last_tax_collected_at: now.toISOString(),
    last_extract_at: now.toISOString(),
    last_upkeep_at: now.toISOString(),
    upkeep_missed_periods: 0,
    storage_cap: BALANCE.colony.defaultStorageCap,
  };

  let colony: Colony | null = null;

  // Helper: refund deducted iron if colony DB operation fails
  async function refundIron(): Promise<void> {
    if (ironDeducted > 0 && stationIdForRefund) {
      await (admin as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .from("resource_inventory")
        .upsert(
          { location_type: "station", location_id: stationIdForRefund, resource_type: "iron", quantity: ironDeducted },
          { onConflict: "location_type,location_id,resource_type" },
        );
    }
  }

  if (existingColony?.status === "collapsed") {
    // Reuse the collapsed row — UPDATE avoids a UNIQUE constraint violation on body_id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateRes = await (admin as any)
      .from("colonies")
      .update(colonyFields)
      .eq("id", existingColony.id)
      .select("*")
      .maybeSingle();
    if (updateRes.error) {
      await refundIron();
      return toErrorResponse(
        fail(
          "internal_error",
          `Colony update failed: ${String(updateRes.error.message ?? updateRes.error)}.`,
        ).error,
      );
    }
    colony = (updateRes.data as Colony) ?? null;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertRes = await (admin as any)
      .from("colonies")
      .insert(colonyFields)
      .select("*")
      .maybeSingle();
    if (insertRes.error) {
      await refundIron();
      // Distinguish a genuine unique-conflict (concurrent claim) from other errors.
      const isConflict =
        insertRes.error.code === "23505" ||
        String(insertRes.error.message).toLowerCase().includes("unique");
      if (isConflict) {
        return toErrorResponse(
          fail("already_exists", "This body was just claimed by another player.").error,
        );
      }
      return toErrorResponse(
        fail(
          "internal_error",
          `Colony founding failed: ${String(insertRes.error.message ?? insertRes.error)}.`,
        ).error,
      );
    }
    colony = (insertRes.data as Colony) ?? null;
  }

  if (!colony) {
    await refundIron();
    return toErrorResponse(
      fail("internal_error", "Colony row was not returned after insert; please retry.").error,
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
