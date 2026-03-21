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
  // resolveAsteroidHarvests handles all active fleets on the asteroid (not just this one)
  // but still correctly deposits only this player's share.
  await resolveAsteroidHarvests(admin, harvest.asteroid_id);

  // ── Mark harvest cancelled ────────────────────────────────────────────────
  await admin
    .from("asteroid_harvests")
    .update({ status: "cancelled" })
    .eq("id", harvestId);

  return Response.json({ ok: true, data: {} });
}
