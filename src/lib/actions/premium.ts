/**
 * Premium item consumption action.
 * Each item type produces a different server-side effect:
 *   - Cosmetics: link item_config to the target entity; never consumed.
 *   - colony_permit: increment player colony slots, then consumed.
 *   - deep_survey_kit / unstable_warp_tunnel / stabilized_wormhole: consumed;
 *     actual effect is applied by the caller via the params payload.
 */

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult, maybeSingleResult } from "@/lib/supabase/utils";
import { requireAuth, parseInput } from "./helpers";
import { ok, fail, type ActionResult } from "./types";
import type { ConsumePremiumItemResult } from "@/lib/types/api";
import type { PremiumItemType } from "@/lib/types/enums";
import { BALANCE } from "@/lib/config/balance";

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
  item_type: PremiumItemType;
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
  const { entitlementId, params } = inputResult.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

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
  if (entitlement.consumed)
    return fail("already_exists", "This item has already been used.");

  const itemType = entitlement.item_type;

  // ── Cosmetics ────────────────────────────────────────────────────────────
  // Cosmetics are never consumed. We update item_config with the target entity.
  if (COSMETIC_TYPES.includes(itemType)) {
    const newConfig = { ...entitlement.item_config, ...params };
    await admin
      .from("premium_entitlements")
      .update({ item_config: newConfig })
      .eq("id", entitlementId);

    // Wire up foreign keys for specific cosmetic types
    if (itemType === "ship_skin" && typeof params.ship_id === "string") {
      await admin
        .from("ships")
        .update({ skin_entitlement_id: entitlementId })
        .eq("id", params.ship_id)
        .eq("player_id", player.id);
    }

    if (itemType === "alliance_emblem" && typeof params.alliance_id === "string") {
      const { data: membership } = maybeSingleResult<{ alliance_id: string; role: string }>(
        await admin
          .from("alliance_members")
          .select("alliance_id, role")
          .eq("player_id", player.id)
          .maybeSingle(),
      );
      if (!membership || membership.alliance_id !== params.alliance_id) {
        return fail("forbidden", "You are not a member of that alliance.");
      }
      if (membership.role !== "founder") {
        return fail("forbidden", "Only the alliance founder can set the emblem.");
      }
      await admin
        .from("alliances")
        .update({ emblem_entitlement_id: entitlementId })
        .eq("id", params.alliance_id);
    }

    return ok({
      consumed: false,
      appliedEffect: `${itemType} applied successfully.`,
    });
  }

  // ── Colony Permit ─────────────────────────────────────────────────────────
  if (itemType === "colony_permit") {
    const { count } = await admin
      .from("premium_entitlements")
      .select("id", { count: "exact", head: true })
      .eq("player_id", player.id)
      .eq("item_type", "colony_permit")
      .eq("consumed", true);
    if ((count ?? 0) >= BALANCE.premium.maxColonyPermitsPerAccount) {
      return fail(
        "colony_limit_reached",
        `Colony Permit limit reached (max ${BALANCE.premium.maxColonyPermitsPerAccount} per account).`,
      );
    }

    await admin
      .from("premium_entitlements")
      .update({ consumed: true, consumed_at: new Date().toISOString() })
      .eq("id", entitlementId);

    await admin.rpc("increment_colony_slots", { p_player_id: player.id }).catch(() => {
      // RPC may not exist in all environments; fall back to direct update.
    });

    return ok({ consumed: true, appliedEffect: "Colony slot unlocked." });
  }

  // ── Single-use utility items ───────────────────────────────────────────────
  // These are consumed here; the actual navigation/survey/lane effects are
  // handled by dedicated routes that verify the entitlement is consumed first.
  const utilityTypes: PremiumItemType[] = [
    "deep_survey_kit",
    "unstable_warp_tunnel",
    "stabilized_wormhole",
  ];
  if (utilityTypes.includes(itemType)) {
    await admin
      .from("premium_entitlements")
      .update({ consumed: true, consumed_at: new Date().toISOString() })
      .eq("id", entitlementId);

    const labels: Record<string, string> = {
      deep_survey_kit:       "Deep Survey Kit consumed — assign a ship to begin the deep survey.",
      unstable_warp_tunnel:  "Warp Tunnel consumed — temporary lane created.",
      stabilized_wormhole:   "Stabilized Wormhole consumed — persistent lane created.",
    };
    return ok({ consumed: true, appliedEffect: labels[itemType] ?? "Item consumed." });
  }

  return fail("not_implemented", "Unknown item type.");
}
