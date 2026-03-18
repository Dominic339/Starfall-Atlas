/**
 * Premium item consumption action.
 * Implementation status: structure + routing complete; effects TODO(phase-12).
 */

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult } from "@/lib/supabase/utils";
import { requireAuth, parseInput } from "./helpers";
import { ok, fail, type ActionResult } from "./types";
import type { ConsumePremiumItemResult } from "@/lib/types/api";
import type { PremiumItemType } from "@/lib/types/enums";

const consumeItemSchema = z.object({
  entitlementId: z.string().uuid(),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

const COSMETIC_TYPES: PremiumItemType[] = [
  "ship_skin",
  "colony_banner",
  "vanity_name_tag",
  "alliance_emblem",
  "discoverer_monument",
];

type EntitlementRow = {
  id: string;
  player_id: string;
  item_type: string;
  consumed: boolean;
  item_config: Record<string, unknown>;
};

export async function consumePremiumItem(
  rawInput: unknown,
): Promise<ActionResult<ConsumePremiumItemResult>> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;
  const { player } = authResult.data;

  const inputResult = parseInput(consumeItemSchema, rawInput);
  if (!inputResult.ok) return inputResult;
  const { entitlementId } = inputResult.data;

  const admin = createAdminClient();

  const { data: entitlement, error } = singleResult<EntitlementRow>(
    await admin
      .from("premium_entitlements")
      .select("id, player_id, item_type, consumed, item_config")
      .eq("id", entitlementId)
      .single(),
  );

  if (error || !entitlement) return fail("not_found", "Entitlement not found.");
  if (entitlement.player_id !== player.id)
    return fail("forbidden", "This item does not belong to you.");

  const isCosmetic = COSMETIC_TYPES.includes(
    entitlement.item_type as PremiumItemType,
  );

  if (isCosmetic) {
    return ok({
      consumed: false,
      appliedEffect: `Cosmetic item ${entitlement.item_type} applied.`,
    });
  }

  if (entitlement.consumed) {
    return fail("already_exists", "This item has already been used.");
  }

  if (
    entitlement.item_type === "colony_permit" &&
    player.colony_permits_used >= 2
  ) {
    return fail(
      "colony_limit_reached",
      "Maximum number of Colony Permits already used (limit: 2 per account).",
    );
  }

  // TODO(phase-12): Execute in transaction with SELECT FOR UPDATE.
  return fail(
    "not_implemented",
    "Premium item effects not yet implemented. Coming in Phase 12.",
  );
}
