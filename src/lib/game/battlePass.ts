/**
 * Battle pass engine.
 *
 * XP is awarded per game action. When accumulated XP crosses xp_per_tier
 * the player advances to the next tier and receives free-track rewards
 * (plus premium rewards if is_premium = true).
 *
 * Quest gating: quest_type determines which game action can award XP for
 * the current tier. Once a tier is fully quested, XP spills into the next
 * tier automatically.
 *
 * All functions take an admin client so they can be called from any route.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuestType =
  | "manual"
  | "gather_resource"
  | "travel_jumps"
  | "found_colonies"
  | "harvest_asteroid"
  | "market_trades"
  | "alliance_activity";

/** The game action that produced the XP award. */
export type XpTrigger =
  | { type: "gather_resource"; resource: string; amount: number }
  | { type: "travel_jumps";    count: number }
  | { type: "found_colonies";  count: number }
  | { type: "harvest_asteroid"; amount: number }
  | { type: "market_trades";   count: number }
  | { type: "alliance_activity" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** XP earned from a trigger given a tier's quest_type and config. */
function xpFromTrigger(
  questType: QuestType,
  questConfig: Record<string, unknown>,
  trigger: XpTrigger,
  xpPerTier: number,
): number {
  if (questType === "manual") return 0;

  // Each quest type maps activity units to XP.
  // The ratio is: completing the quest_config target earns one full tier of XP.
  switch (questType) {
    case "gather_resource": {
      if (trigger.type !== "gather_resource") return 0;
      const target  = (questConfig.resource as string | undefined) ?? "";
      if (target && trigger.resource !== target) return 0;
      const required = (questConfig.amount as number | undefined) ?? 1;
      return Math.floor((trigger.amount / required) * xpPerTier);
    }
    case "harvest_asteroid": {
      if (trigger.type !== "harvest_asteroid") return 0;
      const required = (questConfig.amount as number | undefined) ?? 1;
      return Math.floor((trigger.amount / required) * xpPerTier);
    }
    case "travel_jumps": {
      if (trigger.type !== "travel_jumps") return 0;
      const required = (questConfig.count as number | undefined) ?? 1;
      return Math.floor((trigger.count / required) * xpPerTier);
    }
    case "found_colonies": {
      if (trigger.type !== "found_colonies") return 0;
      const required = (questConfig.count as number | undefined) ?? 1;
      return Math.floor((trigger.count / required) * xpPerTier);
    }
    case "market_trades": {
      if (trigger.type !== "market_trades") return 0;
      const required = (questConfig.count as number | undefined) ?? 1;
      return Math.floor((trigger.count / required) * xpPerTier);
    }
    case "alliance_activity": {
      if (trigger.type !== "alliance_activity") return 0;
      return xpPerTier;
    }
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Reward delivery
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function grantReward(admin: any, playerId: string, rewardType: string, rewardConfig: Record<string, unknown>): Promise<void> {
  switch (rewardType) {
    case "credits": {
      const amount = (rewardConfig.amount as number | undefined) ?? 0;
      if (amount <= 0) return;
      const { data: pRow } = await admin.from("players").select("credits").eq("id", playerId).maybeSingle();
      if (!pRow) return;
      await admin.from("players").update({ credits: (pRow.credits as number) + amount }).eq("id", playerId);
      break;
    }
    case "resource": {
      const resourceType = (rewardConfig.resource_type as string | undefined) ?? "";
      const qty = (rewardConfig.quantity as number | undefined) ?? 0;
      if (!resourceType || qty <= 0) return;
      // Deposit into player's station inventory
      const { data: stationRow } = await admin
        .from("player_stations").select("id").eq("owner_id", playerId).maybeSingle();
      if (!stationRow?.id) return;
      const stationId = stationRow.id as string;
      const { data: existing } = await admin
        .from("resource_inventory")
        .select("quantity")
        .eq("location_id", stationId).eq("location_type", "station").eq("resource_type", resourceType)
        .maybeSingle();
      await admin.from("resource_inventory").upsert([{
        location_id: stationId, location_type: "station",
        resource_type: resourceType,
        quantity: (existing?.quantity ?? 0) + qty,
      }], { onConflict: "location_type,location_id,resource_type" });
      break;
    }
    case "skin": {
      const skinId = (rewardConfig.skin_id as string | undefined) ?? "";
      if (!skinId) return;
      await admin.from("player_skins").upsert([{ player_id: playerId, skin_id: skinId, source: "gift" }], { onConflict: "player_id,skin_id" });
      break;
    }
    // ship_class and title rewards are noted but not yet mechanically applied
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Main: award XP to a player for the active battle pass
// ---------------------------------------------------------------------------

export interface AwardXpResult {
  tiersAdvanced: number;
  newTier: number;
  newXp: number;
  passId: string | null;
}

/**
 * Award XP to a player based on an in-game action trigger.
 * - Finds the active battle pass (if any).
 * - Ensures the player has a progress row (auto-enrolls if needed).
 * - Computes XP from the trigger relative to the current tier's quest.
 * - Advances tiers and delivers free (+ premium) rewards.
 *
 * Safe to call fire-and-forget — catches all errors internally.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function awardBattlePassXp(admin: any, playerId: string, trigger: XpTrigger): Promise<AwardXpResult> {
  const empty: AwardXpResult = { tiersAdvanced: 0, newTier: 0, newXp: 0, passId: null };

  try {
    const now = new Date().toISOString();

    // ── Find active pass ────────────────────────────────────────────────────
    const { data: passRow } = await admin
      .from("battle_passes")
      .select("id, max_tier, xp_per_tier")
      .eq("is_active", true)
      .lte("starts_at", now)
      .gte("ends_at", now)
      .order("season_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!passRow) return empty;

    const passId     = passRow.id as string;
    const maxTier    = passRow.max_tier as number;
    const xpPerTier  = passRow.xp_per_tier as number;

    // ── Fetch or auto-enroll player progress ───────────────────────────────
    let { data: progress } = await admin
      .from("player_battle_pass")
      .select("id, current_tier, xp_points, is_premium")
      .eq("player_id", playerId).eq("pass_id", passId)
      .maybeSingle();

    if (!progress) {
      const { data: enrolled } = await admin
        .from("player_battle_pass")
        .insert({ player_id: playerId, pass_id: passId, current_tier: 0, xp_points: 0, is_premium: false })
        .select("id, current_tier, xp_points, is_premium")
        .maybeSingle();
      if (!enrolled) return empty;
      progress = enrolled;
    }

    let currentTier = progress.current_tier as number;
    let currentXp   = progress.xp_points as number;
    const isPremium  = progress.is_premium as boolean;

    if (currentTier >= maxTier) return { tiersAdvanced: 0, newTier: currentTier, newXp: currentXp, passId };

    // ── Fetch current tier definition ──────────────────────────────────────
    const { data: tierDef } = await admin
      .from("battle_pass_tiers")
      .select("quest_type, quest_config, free_reward_type, free_reward_config, premium_reward_type, premium_reward_config")
      .eq("pass_id", passId)
      .eq("tier", currentTier + 1)
      .maybeSingle();

    if (!tierDef) return { tiersAdvanced: 0, newTier: currentTier, newXp: currentXp, passId };

    // ── Compute XP earned ──────────────────────────────────────────────────
    const questType   = (tierDef.quest_type ?? "manual") as QuestType;
    const questConfig = (tierDef.quest_config ?? {}) as Record<string, unknown>;
    const xpEarned = xpFromTrigger(questType, questConfig, trigger, xpPerTier);

    if (xpEarned <= 0) return { tiersAdvanced: 0, newTier: currentTier, newXp: currentXp, passId };

    currentXp += xpEarned;
    let tiersAdvanced = 0;

    // ── Advance tiers ──────────────────────────────────────────────────────
    while (currentXp >= xpPerTier && currentTier < maxTier) {
      currentXp -= xpPerTier;
      currentTier += 1;
      tiersAdvanced += 1;

      // Fetch and deliver rewards for the unlocked tier
      const { data: rewardTier } = await admin
        .from("battle_pass_tiers")
        .select("free_reward_type, free_reward_config, premium_reward_type, premium_reward_config")
        .eq("pass_id", passId).eq("tier", currentTier)
        .maybeSingle();

      if (rewardTier) {
        await grantReward(admin, playerId, rewardTier.free_reward_type ?? "credits", rewardTier.free_reward_config ?? {});
        if (isPremium && rewardTier.premium_reward_type) {
          await grantReward(admin, playerId, rewardTier.premium_reward_type, rewardTier.premium_reward_config ?? {});
        }
      }
    }

    // ── Persist progress ───────────────────────────────────────────────────
    await admin
      .from("player_battle_pass")
      .update({ current_tier: currentTier, xp_points: currentXp, updated_at: new Date().toISOString() })
      .eq("id", progress.id);

    return { tiersAdvanced, newTier: currentTier, newXp: currentXp, passId };
  } catch {
    return empty;
  }
}
