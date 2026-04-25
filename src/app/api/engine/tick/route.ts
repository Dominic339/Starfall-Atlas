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

export async function POST() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balance = await getBalanceWithOverrides(admin as any);
  const result = await runEngineTick(admin, player.id, new Date(), balance);

  return Response.json({ ok: true, data: result });
}
