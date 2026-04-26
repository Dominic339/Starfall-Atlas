/**
 * GET /api/game/battle-pass/status
 *
 * Returns the active battle pass definition + the player's current progress.
 * Auto-enrolls the player if not yet enrolled.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date().toISOString();

  // Fetch active pass
  const { data: pass } = await admin
    .from("battle_passes")
    .select("*")
    .eq("is_active", true)
    .lte("starts_at", now)
    .gte("ends_at", now)
    .order("season_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pass) {
    return Response.json({ ok: true, data: { pass: null, progress: null, tiers: [] } });
  }

  // Fetch tiers
  const { data: tiers } = await admin
    .from("battle_pass_tiers")
    .select("id, tier, quest_label, quest_type, quest_config, free_reward_type, free_reward_config, premium_reward_type, premium_reward_config")
    .eq("pass_id", pass.id)
    .order("tier");

  // Fetch or auto-enroll player progress
  let { data: progress } = await admin
    .from("player_battle_pass")
    .select("id, current_tier, xp_points, is_premium, created_at, updated_at")
    .eq("player_id", player.id)
    .eq("pass_id", pass.id)
    .maybeSingle();

  if (!progress) {
    const { data: enrolled } = await admin
      .from("player_battle_pass")
      .insert({ player_id: player.id, pass_id: pass.id, current_tier: 0, xp_points: 0, is_premium: false })
      .select("id, current_tier, xp_points, is_premium, created_at, updated_at")
      .maybeSingle();
    progress = enrolled;
  }

  return Response.json({ ok: true, data: { pass, progress, tiers: tiers ?? [] } });
}
