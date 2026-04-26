/**
 * POST /api/engine/tick
 *
 * Resolves colony growth and upkeep for the authenticated player.
 * Safe to call multiple times (lazy/idempotent by timestamp comparison).
 *
 * This endpoint wraps the runEngineTick() lib function, which is also
 * called directly by the command page server component.
 *
 * Body: {} (no body required — player identity comes from session cookie)
 * Returns: { ok: true, data: EngineTickResult }
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { runEngineTick } from "@/lib/game/engineTick";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalanceWithOverrides } from "@/lib/config/balanceOverrides";
import { getActiveLiveEvents } from "@/lib/game/liveEvents";

export async function POST() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;
  const now = new Date();
  const [balance, liveEvents] = await Promise.all([
    getBalanceWithOverrides(adminAny),
    getActiveLiveEvents(adminAny, now),
  ]);
  const result = await runEngineTick(admin, player.id, now, balance, liveEvents);

  return Response.json({ ok: true, data: result });
}
