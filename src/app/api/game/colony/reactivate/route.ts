/**
 * POST /api/game/colony/reactivate
 *
 * Manually reactivates a single abandoned colony that is still within the
 * 7-day resolution window. The automatic path (visiting any page while the
 * engine tick fires) handles bulk reactivation; this endpoint exists for
 * explicit per-colony UI actions and error-recovery.
 *
 * Rules:
 *   1. Player owns the colony.
 *   2. Colony status is 'abandoned'.
 *   3. now − abandoned_at < resolutionWindowDays (still within the window).
 *
 * On success:
 *   - colony.status → 'active', abandoned_at → null
 *   - All structures in colony → is_active = true
 *   - World event: colony_reactivated
 *   - Influence cache refreshed for the system
 *
 * Body: { colonyId: string }
 * Returns: { ok: true, data: { colonyId } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";
import { refreshInfluenceCache } from "@/lib/game/influence";
import type { Colony } from "@/lib/types/game";

const WINDOW_MS = BALANCE.inactivity.resolutionWindowDays * 24 * 3_600_000;

const Schema = z.object({
  colonyId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { colonyId } = input.data as { colonyId: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Fetch colony ─────────────────────────────────────────────────────────
  const { data: colony } = maybeSingleResult<Colony>(
    await admin
      .from("colonies")
      .select("*")
      .eq("id", colonyId)
      .eq("owner_id", player.id)
      .maybeSingle(),
  );

  if (!colony) {
    return toErrorResponse(fail("not_found", "Colony not found.").error);
  }

  if (colony.status !== "abandoned") {
    return toErrorResponse(
      fail("invalid_target", `Colony is ${colony.status}, not abandoned.`).error,
    );
  }

  // ── Window check ─────────────────────────────────────────────────────────
  const now = new Date();
  if (colony.abandoned_at) {
    const elapsed = now.getTime() - new Date(colony.abandoned_at).getTime();
    if (elapsed >= WINDOW_MS) {
      return toErrorResponse(
        fail(
          "invalid_target",
          `The ${BALANCE.inactivity.resolutionWindowDays}-day reactivation window has expired. This colony has collapsed.`,
        ).error,
      );
    }
  }

  // ── Reactivate ────────────────────────────────────────────────────────────
  await admin
    .from("colonies")
    .update({ status: "active", abandoned_at: null })
    .eq("id", colonyId);

  await admin
    .from("structures")
    .update({ is_active: true })
    .eq("colony_id", colonyId);

  await admin.from("world_events").insert({
    event_type: "colony_reactivated",
    player_id:  player.id,
    system_id:  colony.system_id,
    body_id:    null,
    metadata:   { colony_id: colonyId },
  });

  // Refresh influence cache (reactivated colony contributes influence again)
  void refreshInfluenceCache(admin, colony.system_id).catch(() => undefined);

  return Response.json({ ok: true, data: { colonyId } });
}
