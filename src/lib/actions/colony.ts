/**
 * Colony management actions: tax collection, structure building.
 * Implementation status: structure complete; DB writes TODO(phase-5/6).
 */

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult } from "@/lib/supabase/utils";
import { requireAuth, parseInput } from "./helpers";
import { ok, fail, type ActionResult } from "./types";
import { calculateAccumulatedTax } from "@/lib/game/taxes";
import type { CollectTaxesResult, BuildStructureResult } from "@/lib/types/api";
import type { StructureType } from "@/lib/types/enums";

// ---------------------------------------------------------------------------
// Collect taxes
// ---------------------------------------------------------------------------

const collectTaxesSchema = z.object({
  colonyId: z.string().uuid(),
});

type ColonyTaxRow = {
  id: string;
  owner_id: string;
  population_tier: number;
  last_tax_collected_at: string;
};

export async function collectTaxes(
  rawInput: unknown,
): Promise<ActionResult<CollectTaxesResult>> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;
  const { player } = authResult.data;

  const inputResult = parseInput(collectTaxesSchema, rawInput);
  if (!inputResult.ok) return inputResult;
  const { colonyId } = inputResult.data;

  const admin = createAdminClient();

  const { data: colony, error } = singleResult<ColonyTaxRow>(
    await admin
      .from("colonies")
      .select("id, owner_id, population_tier, last_tax_collected_at")
      .eq("id", colonyId)
      .single(),
  );

  if (error || !colony) return fail("not_found", "Colony not found.");
  if (colony.owner_id !== player.id)
    return fail("forbidden", "You do not own this colony.");

  const credits = calculateAccumulatedTax(
    colony.last_tax_collected_at,
    colony.population_tier,
  );

  if (credits === 0) {
    return ok({ creditsCollected: 0, newBalance: player.credits });
  }

  // TODO(phase-5): Execute as a transaction with SELECT FOR UPDATE.
  return fail(
    "not_implemented",
    "Tax collection transaction not yet implemented. Coming in Phase 5.",
  );
}

// ---------------------------------------------------------------------------
// Build structure
// ---------------------------------------------------------------------------

const VALID_STRUCTURE_TYPES: StructureType[] = [
  "extractor",
  "warehouse",
  "trade_hub",
  "relay_station",
  // "shipyard" excluded — post-alpha only
];

const buildStructureSchema = z.object({
  colonyId: z.string().uuid(),
  structureType: z.enum(
    VALID_STRUCTURE_TYPES as [StructureType, ...StructureType[]],
  ),
  extractResourceType: z.string().optional(),
});

type ColonyOwnerRow = { id: string; owner_id: string };

export async function buildStructure(
  rawInput: unknown,
): Promise<ActionResult<BuildStructureResult>> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;
  const { player } = authResult.data;

  const inputResult = parseInput(buildStructureSchema, rawInput);
  if (!inputResult.ok) return inputResult;
  const { colonyId, structureType, extractResourceType } = inputResult.data;

  if (structureType === "extractor" && !extractResourceType) {
    return fail(
      "validation_error",
      "extractResourceType is required when building an Extractor.",
    );
  }

  const admin = createAdminClient();

  const { data: colony, error } = singleResult<ColonyOwnerRow>(
    await admin
      .from("colonies")
      .select("id, owner_id")
      .eq("id", colonyId)
      .single(),
  );

  if (error || !colony) return fail("not_found", "Colony not found.");
  if (colony.owner_id !== player.id)
    return fail("forbidden", "You do not own this colony.");

  // TODO(phase-6): Check resource costs, deduct, insert structure and job.
  return fail(
    "not_implemented",
    "Structure construction not yet implemented. Coming in Phase 6.",
  );
}
