/**
 * POST /api/game/asteroid/recall
 *
 * Recalls a fleet from asteroid harvesting, resolving any pending yield first.
 *
 * Steps:
 *   1. Auth + ownership checks.
 *   2. Lazy resolution: deposit any pending harvest yield to station inventory.
 *   3. Mark asteroid_harvest as 'cancelled'.
 *
 * Body:   { harvestId: string }
 * Returns: { ok: true, data: { resourcesDeposited: number } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAsteroidHarvests } from "@/lib/game/asteroids";
import { getBalanceWithOverrides } from "@/lib/config/balanceOverrides";
import { awardBattlePassXp } from "@/lib/game/battlePass";

const RecallSchema = z.object({
  harvestId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(RecallSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { harvestId } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const balance = await getBalanceWithOverrides(admin);

  // ── Fetch harvest ────────────────────────────────────────────────────────
  const { data: harvest } = await admin
    .from("asteroid_harvests")
    .select("id, asteroid_id, player_id, status")
    .eq("id", harvestId)
    .maybeSingle();

  if (!harvest) {
    return toErrorResponse(fail("not_found", "Harvest record not found.").error);
  }
  if (harvest.player_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You do not own this harvest.").error);
  }
  if (harvest.status !== "active") {
    return toErrorResponse(fail("invalid_target", "This harvest is no longer active.").error);
  }

  // ── Lazy resolution: deposit pending yield ────────────────────────────────
  // Capture remaining before to estimate what was deposited
  const { data: asteroidBefore } = await admin
    .from("asteroid_nodes").select("remaining_amount").eq("id", harvest.asteroid_id).maybeSingle();
  const remainingBefore = asteroidBefore?.remaining_amount ?? 0;

  await resolveAsteroidHarvests(admin, harvest.asteroid_id, balance);

  const { data: asteroidAfter } = await admin
    .from("asteroid_nodes").select("remaining_amount").eq("id", harvest.asteroid_id).maybeSingle();
  const deposited = Math.max(0, remainingBefore - (asteroidAfter?.remaining_amount ?? 0));

  // ── Mark harvest cancelled ────────────────────────────────────────────────
  await admin
    .from("asteroid_harvests")
    .update({ status: "cancelled" })
    .eq("id", harvestId);

  // Award battle pass XP for harvested amount (fire-and-forget)
  if (deposited > 0) {
    void awardBattlePassXp(admin, player.id, { type: "harvest_asteroid", amount: deposited });
  }

  return Response.json({ ok: true, data: { resourcesDeposited: deposited } });
}
