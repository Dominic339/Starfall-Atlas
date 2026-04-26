/**
 * POST /api/game/battle-pass/upgrade
 *
 * Upgrades the player's battle pass enrollment to premium.
 * Deducts credits (or premium currency) and delivers all already-earned
 * premium rewards retroactively.
 */

import { type NextRequest } from "next/server";
import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const { passId, usePremiumCurrency = false } = body as { passId?: string; usePremiumCurrency?: boolean };

  if (!passId) return toErrorResponse(fail("validation_error", "passId is required").error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Fetch pass
  const { data: pass } = await admin
    .from("battle_passes")
    .select("id, premium_cost_credits, premium_cost_premium, is_active, starts_at, ends_at")
    .eq("id", passId)
    .maybeSingle();

  if (!pass) return toErrorResponse(fail("not_found", "Battle pass not found").error);
  if (!pass.is_active) return toErrorResponse(fail("invalid_target", "This battle pass is no longer active").error);

  const now = new Date().toISOString();
  if (pass.ends_at < now) return toErrorResponse(fail("invalid_target", "This battle pass has ended").error);

  // Fetch or enroll progress
  let { data: progress } = await admin
    .from("player_battle_pass")
    .select("id, current_tier, xp_points, is_premium")
    .eq("player_id", player.id).eq("pass_id", passId)
    .maybeSingle();

  if (!progress) {
    const { data: enrolled } = await admin
      .from("player_battle_pass")
      .insert({ player_id: player.id, pass_id: passId, current_tier: 0, xp_points: 0, is_premium: false })
      .select("id, current_tier, xp_points, is_premium")
      .maybeSingle();
    progress = enrolled;
  }

  if (progress?.is_premium) {
    return toErrorResponse(fail("invalid_target", "Already on the premium track").error);
  }

  // Check cost
  // Only credits-based upgrade is supported for now (premium currency field is future)
  const cost = (pass.premium_cost_credits ?? 0) as number;
  if (player.credits < cost) {
    return toErrorResponse(fail("insufficient_credits", `Requires ${cost} credits`).error);
  }
  if (cost > 0) {
    await admin.from("players").update({ credits: player.credits - cost }).eq("id", player.id);
  }

  // Mark premium
  await admin.from("player_battle_pass").update({ is_premium: true, updated_at: new Date().toISOString() }).eq("id", progress.id);

  // Retroactively deliver premium rewards for already-unlocked tiers
  if ((progress.current_tier ?? 0) > 0) {
    const { data: earnedTiers } = await admin
      .from("battle_pass_tiers")
      .select("tier, premium_reward_type, premium_reward_config")
      .eq("pass_id", passId)
      .lte("tier", progress.current_tier)
      .not("premium_reward_type", "is", null);

    for (const t of earnedTiers ?? []) {
      if (!t.premium_reward_type) continue;
      // Deliver reward inline (credits/resources/skins)
      if (t.premium_reward_type === "credits") {
        const amt = (t.premium_reward_config?.amount as number | undefined) ?? 0;
        if (amt > 0) {
          const { data: p2 } = await admin.from("players").select("credits").eq("id", player.id).maybeSingle();
          await admin.from("players").update({ credits: (p2?.credits ?? 0) + amt }).eq("id", player.id);
        }
      }
      if (t.premium_reward_type === "skin") {
        const skinId = t.premium_reward_config?.skin_id as string | undefined;
        if (skinId) {
          await admin.from("player_skins").upsert([{ player_id: player.id, skin_id: skinId, acquired_via: "battle_pass" }], { onConflict: "player_id,skin_id" });
        }
      }
    }
  }

  return Response.json({ ok: true, data: { isPremium: true } });
}
