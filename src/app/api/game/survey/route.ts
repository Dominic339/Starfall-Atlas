/**
 * POST /api/game/survey
 *
 * Performs an instant basic survey of a body in a discovered system.
 *
 * Alpha simplification: survey is instantaneous (no timer job). The
 * survey_jobs table is not used in this phase — survey results are
 * created directly. A TODO marks where the async job pattern can be
 * introduced once survey timers are needed.
 *
 * Survey results are shared: once any player surveys a body, the basic
 * resource profile becomes visible to all players. Idempotent: re-surveying
 * an already-surveyed body returns the existing result.
 *
 * Validation:
 *   1. Authenticated player.
 *   2. bodyId must resolve to a valid catalog system + body index.
 *   3. Player's ship must be physically present in the system.
 *   4. Player must have discovered the system (Sol is exempt — always known).
 *
 * Body: { bodyId: string }   e.g. "hyg:70890:0" or "sol:3"
 * Returns: { ok: true, data: { survey: SurveyResult } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";
import type { Ship, SystemDiscovery, SurveyResult, PlayerStation } from "@/lib/types/game";

const SurveySchema = z.object({
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
  const input = parseInput(SurveySchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { bodyId } = input.data;

  // ── Parse body ID ────────────────────────────────────────────────────────
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

  // ── Catalog check ─────────────────────────────────────────────────────────
  const catalogEntry = getCatalogEntry(systemId);
  if (!catalogEntry) {
    return toErrorResponse(
      fail("not_found", `System '${systemId}' is not in the catalog.`).error,
    );
  }

  const admin = createAdminClient();

  // ── Presence check (ship or station) ─────────────────────────────────────
  // Either a ship or the player's station being present in the system suffices.
  const [{ data: allShips }, { data: stationRow }] = await Promise.all([
    listResult<Pick<Ship, "current_system_id">>(
      await admin
        .from("ships")
        .select("current_system_id")
        .eq("owner_id", player.id),
    ),
    maybeSingleResult<Pick<PlayerStation, "current_system_id">>(
      await admin
        .from("player_stations")
        .select("current_system_id")
        .eq("owner_id", player.id)
        .maybeSingle(),
    ),
  ]);

  const shipPresent    = (allShips ?? []).some((s) => s.current_system_id === systemId);
  const stationPresent = stationRow?.current_system_id === systemId;

  if (!shipPresent && !stationPresent) {
    return toErrorResponse(
      fail(
        "invalid_target",
        "Your ship or station must be present in the system to survey it.",
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
          "You must discover this system before surveying its bodies.",
        ).error,
      );
    }
  }

  // ── Generate body data ────────────────────────────────────────────────────
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

  // ── Idempotency: return existing result if already surveyed ───────────────
  const { data: existing } = maybeSingleResult<SurveyResult>(
    await admin
      .from("survey_results")
      .select("*")
      .eq("body_id", bodyId)
      .maybeSingle(),
  );

  if (existing) {
    return Response.json({ ok: true, data: { survey: existing } });
  }

  // ── Serialize resource nodes from deterministic generation ────────────────
  // Basic survey: expose the basic resource profile.
  // Deep nodes exist but are only revealed by a Deep Survey Kit (premium item).
  // TODO(phase-6): Introduce survey timer (basicSurveyHours) using survey_jobs.
  const resourceNodes = generatedBody.basicResourceNodes.map((n) => ({
    type: n.type,
    quantity: n.quantity,
    is_rare: n.isRare,
  }));

  const hasDeepNodes = generatedBody.deepResourceNodes.length > 0;

  // ── Insert survey result ───────────────────────────────────────────────────
  const { data: survey } = maybeSingleResult<SurveyResult>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("survey_results")
      .insert({
        system_id: systemId,
        body_id: bodyId,
        revealed_by: player.id,
        resource_nodes: resourceNodes,
        has_deep_nodes: hasDeepNodes,
        deep_nodes: [],
      })
      .select("*")
      .maybeSingle(),
  );

  if (!survey) {
    // Concurrent insert: another request surveyed the same body in the narrow
    // window between our idempotency check and our insert.
    const { data: raced } = maybeSingleResult<SurveyResult>(
      await admin
        .from("survey_results")
        .select("*")
        .eq("body_id", bodyId)
        .maybeSingle(),
    );
    return Response.json({ ok: true, data: { survey: raced } });
  }

  return Response.json({ ok: true, data: { survey } });
}
