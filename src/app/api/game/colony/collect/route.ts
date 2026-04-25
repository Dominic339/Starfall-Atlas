/**
 * POST /api/game/colony/collect
 *
 * Collects accrued taxes from a colony into the player's credit balance.
 * Tax is calculated lazily from elapsed time since last collection.
 * Accumulated yield is capped at BALANCE.colony.taxAccumulationCapHours.
 *
 * Atomicity note: colony timestamp and player credits are updated in two
 * sequential statements (no Postgres transaction). Colony timer is reset
 * FIRST so that a credits update failure results in lost taxes rather than
 * double-collecting. TODO(phase-6): wrap in a Postgres RPC for full safety.
 *
 * Body: { colonyId: string }
 * Returns: { ok: true, data: { creditsCollected: number, newBalance: number } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult } from "@/lib/supabase/utils";
import { calculateAccumulatedTax } from "@/lib/game/taxes";
import { taxMultiplier } from "@/lib/game/colonyUpkeep";
import { getBalanceWithOverrides } from "@/lib/config/balanceOverrides";
import type { Colony, Player } from "@/lib/types/game";

const CollectSchema = z.object({
  colonyId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(CollectSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { colonyId } = input.data;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balance = await getBalanceWithOverrides(admin as any);

  // ── Fetch colony ─────────────────────────────────────────────────────────
  const { data: colony } = singleResult<Colony>(
    await admin
      .from("colonies")
      .select("id, owner_id, population_tier, last_tax_collected_at, status, upkeep_missed_periods")
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
        "Cannot collect taxes from a colony that is not active.",
      ).error,
    );
  }

  // ── Calculate accrued taxes ───────────────────────────────────────────────
  const now = new Date();
  const rawCredits = calculateAccumulatedTax(
    colony.last_tax_collected_at,
    colony.population_tier,
    now,
    balance,
  );
  // Apply health multiplier (struggling = 75%, neglected = 50%).
  const credits = Math.floor(rawCredits * taxMultiplier(colony.upkeep_missed_periods));

  if (credits === 0) {
    return Response.json({
      ok: true,
      data: { creditsCollected: 0, newBalance: player.credits },
    });
  }

  // ── Reset colony tax timer first (safer failure mode) ────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("colonies")
    .update({ last_tax_collected_at: now.toISOString() })
    .eq("id", colonyId);

  // ── Credit player ─────────────────────────────────────────────────────────
  const { data: updatedPlayer } = singleResult<Pick<Player, "credits">>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("players")
      .update({ credits: player.credits + credits })
      .eq("id", player.id)
      .select("credits")
      .single(),
  );

  const newBalance = updatedPlayer?.credits ?? player.credits + credits;

  return Response.json({
    ok: true,
    data: { creditsCollected: credits, newBalance },
  });
}
