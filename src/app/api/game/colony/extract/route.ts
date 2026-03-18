/**
 * POST /api/game/colony/extract
 *
 * Extracts accumulated resources from a colony into the colony's own inventory
 * (resource flow: colony production → colony inventory, GAME_RULES.md §7.1).
 *
 * Phase 7: Resources accumulate in colony inventory first. Players then use
 * POST /api/game/ship/load to move resources to ship cargo, and
 * POST /api/game/ship/unload to transfer from ship to station.
 *
 * Extraction is based on:
 *   - Survey result resource nodes for the colony's body (basic nodes only)
 *   - Colony population tier (tier N → N × baseUnitsPerHrPerTier per node/hr)
 *   - Elapsed time since last_extract_at, capped at accumulationCapHours
 *
 * Atomicity note: last_extract_at is reset BEFORE inventory is updated
 * (safer failure mode: lose resources rather than double-extract).
 * TODO(phase-7): wrap in a Postgres RPC for full transactional safety.
 *
 * Body: { colonyId: string }
 * Returns: { ok: true, data: { extracted: ExtractionAmount[], colonyId: string } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult, maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { calculateAccumulatedExtraction } from "@/lib/game/extraction";
import type {
  Colony,
  SurveyResult,
  ResourceInventoryRow,
} from "@/lib/types/game";

const ExtractSchema = z.object({
  colonyId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(ExtractSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { colonyId } = input.data;

  const admin = createAdminClient();

  // ── Fetch colony ─────────────────────────────────────────────────────────
  const { data: colony } = singleResult<Colony>(
    await admin
      .from("colonies")
      .select("id, owner_id, body_id, population_tier, status, last_extract_at")
      .eq("id", colonyId)
      .single(),
  );

  if (!colony) {
    return toErrorResponse(fail("not_found", "Colony not found.").error);
  }

  if (colony.owner_id !== player.id) {
    return toErrorResponse(
      fail("forbidden", "You do not own this colony.").error,
    );
  }

  if (colony.status !== "active") {
    return toErrorResponse(
      fail(
        "invalid_target",
        "Cannot extract from a colony that is not active.",
      ).error,
    );
  }

  // ── Fetch survey result ───────────────────────────────────────────────────
  const { data: survey } = maybeSingleResult<
    Pick<SurveyResult, "resource_nodes">
  >(
    await admin
      .from("survey_results")
      .select("resource_nodes")
      .eq("body_id", colony.body_id)
      .maybeSingle(),
  );

  if (!survey || survey.resource_nodes.length === 0) {
    return toErrorResponse(
      fail(
        "invalid_target",
        "No survey data found for this body. Survey the body before extracting.",
      ).error,
    );
  }

  // ── Calculate accumulated extraction ──────────────────────────────────────
  const now = new Date();
  // Fall back to now (= 0 yield) if last_extract_at is somehow null.
  const lastExtractAt = colony.last_extract_at ?? now.toISOString();

  const extracted = calculateAccumulatedExtraction(
    survey.resource_nodes,
    colony.population_tier,
    lastExtractAt,
    now,
  );

  if (extracted.length === 0) {
    return Response.json({
      ok: true,
      data: { extracted: [], colonyId },
    });
  }

  // ── Reset extraction timer FIRST (safer: lose resources > double-extract) ─
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("colonies")
    .update({ last_extract_at: now.toISOString() })
    .eq("id", colonyId);

  // ── Fetch current colony inventory for the extracted resource types ────────
  const resourceTypes = extracted.map((e) => e.resource_type);
  const { data: existingRows } = listResult<
    Pick<ResourceInventoryRow, "resource_type" | "quantity">
  >(
    await admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "colony")
      .eq("location_id", colonyId)
      .in("resource_type", resourceTypes),
  );

  const existing = new Map(
    (existingRows ?? []).map((r) => [r.resource_type, r.quantity]),
  );

  // ── Upsert incremented quantities into colony inventory ───────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("resource_inventory")
    .upsert(
      extracted.map((item) => ({
        location_type: "colony",
        location_id: colonyId,
        resource_type: item.resource_type,
        quantity: (existing.get(item.resource_type) ?? 0) + item.quantity,
      })),
      { onConflict: "location_type,location_id,resource_type" },
    );

  return Response.json({
    ok: true,
    data: { extracted, colonyId },
  });
}
