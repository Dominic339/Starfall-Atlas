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
import { extractionMultiplier } from "@/lib/game/colonyUpkeep";
import {
  getStructureTier,
  researchLevel,
  extractionBonusMultiplier,
} from "@/lib/game/colonyStructures";
import { getBalanceWithOverrides } from "@/lib/config/balanceOverrides";
import { getActiveLiveEvents, dropMultiplier } from "@/lib/game/liveEvents";
import { awardBattlePassXp } from "@/lib/game/battlePass";
import type {
  Colony,
  Structure,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;
  const [balance, liveEvents] = await Promise.all([
    getBalanceWithOverrides(adminAny),
    getActiveLiveEvents(adminAny),
  ]);

  // ── Fetch colony ─────────────────────────────────────────────────────────
  const { data: colony } = singleResult<Colony>(
    await admin
      .from("colonies")
      .select("id, owner_id, body_id, population_tier, status, last_extract_at, upkeep_missed_periods, created_at")
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

  // ── Fetch colony structures and player research for extraction bonus ────────
  const [structuresRes, researchRes] = await Promise.all([
    admin
      .from("structures")
      .select("type, tier, is_active")
      .eq("colony_id", colonyId)
      .eq("is_active", true),
    admin
      .from("player_research")
      .select("research_id")
      .eq("player_id", player.id),
  ]);

  type StructureRow = Pick<Structure, "type" | "tier" | "is_active">;
  const colonyStructures = ((structuresRes.data ?? []) as StructureRow[]);
  const unlockedIds = new Set(
    ((researchRes.data ?? []) as { research_id: string }[]).map((r) => r.research_id),
  );
  const extractorTier = getStructureTier(colonyStructures as Structure[], "extractor");
  const extractionResLvl = researchLevel(unlockedIds, "extraction");
  const extBonusMult = extractionBonusMultiplier(extractorTier, extractionResLvl);

  // ── Calculate accumulated extraction ──────────────────────────────────────
  const now = new Date();
  // Fall back to colony founding time so first-time extraction accrues from day 1.
  const lastExtractAt = colony.last_extract_at ?? colony.created_at;

  const rawExtracted = calculateAccumulatedExtraction(
    survey.resource_nodes,
    colony.population_tier,
    lastExtractAt,
    now,
    extBonusMult,
    balance,
  );

  // Apply health multiplier and double_drop event bonus.
  const mult = extractionMultiplier(colony.upkeep_missed_periods);
  const eventMult = dropMultiplier(liveEvents);
  const extracted = rawExtracted
    .map((item) => ({ ...item, quantity: Math.floor(item.quantity * mult * eventMult) }))
    .filter((item) => item.quantity > 0);

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

  // ── Royalty payment (fire-and-forget) ─────────────────────────────────────
  // Derive system_id from body_id format "systemId:bodyIndex"
  const lastColon  = colony.body_id.lastIndexOf(":");
  const systemId   = lastColon > 0 ? colony.body_id.slice(0, lastColon) : null;

  if (systemId) {
    void payRoyalty(admin, systemId, player.id, extracted, balance);
  }

  // Award battle pass XP for gathered resources (fire-and-forget)
  for (const item of extracted) {
    void awardBattlePassXp(admin, player.id, { type: "gather_resource", resource: item.resource_type, amount: item.quantity });
  }

  return Response.json({
    ok: true,
    data: { extracted, colonyId },
  });
}

// ---------------------------------------------------------------------------
// Royalty helper — runs fire-and-forget, never throws into the main request
// ---------------------------------------------------------------------------

type ExtractionAmount = { resource_type: string; quantity: number };

async function payRoyalty(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  systemId: string,
  colonyOwnerId: string,
  extracted: ExtractionAmount[],
  balance: import("@/lib/config/balanceOverrides").BalanceConfig,
): Promise<void> {
  try {
    const { data: stewardRow } = await admin
      .from("system_stewardship")
      .select("steward_id, has_governance, royalty_rate")
      .eq("system_id", systemId)
      .maybeSingle() as { data: { steward_id: string; has_governance: boolean; royalty_rate: number } | null };

    if (!stewardRow || stewardRow.royalty_rate <= 0) return;

    let governanceHolderId: string;
    if (stewardRow.has_governance) {
      governanceHolderId = stewardRow.steward_id;
    } else {
      const { data: majorityRow } = await admin
        .from("system_majority_control")
        .select("controller_id, is_confirmed")
        .eq("system_id", systemId)
        .maybeSingle() as { data: { controller_id: string; is_confirmed: boolean } | null };
      if (!majorityRow?.is_confirmed) return;
      governanceHolderId = majorityRow.controller_id;
    }

    // No royalty when colony owner IS the governance holder
    if (governanceHolderId === colonyOwnerId) return;

    // Compute credit value using EUX floor prices as a benchmark
    const floorPrices = balance.emergencyExchange.floorPricePerUnit as Record<string, number>;
    const DEFAULT_CREDIT_VALUE = 2; // credits/unit for unlisted resources
    let totalCreditValue = 0;
    for (const item of extracted) {
      const pricePerUnit = floorPrices[item.resource_type] ?? DEFAULT_CREDIT_VALUE;
      totalCreditValue += item.quantity * pricePerUnit;
    }

    const royaltyCredits = Math.floor(totalCreditValue * stewardRow.royalty_rate / 100);
    if (royaltyCredits <= 0) return;

    // Credit the governance holder's wallet
    const { data: govPlayer } = await admin
      .from("players")
      .select("credits")
      .eq("id", governanceHolderId)
      .maybeSingle() as { data: { credits: number } | null };
    if (!govPlayer) return;

    await admin
      .from("players")
      .update({ credits: govPlayer.credits + royaltyCredits })
      .eq("id", governanceHolderId);
  } catch {
    // Fire-and-forget — never fail the main extraction
  }
}
