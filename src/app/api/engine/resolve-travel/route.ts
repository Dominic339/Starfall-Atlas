/**
 * POST /api/engine/resolve-travel
 *
 * Resolves all arrived travel_jobs and advances auto-ship state machines
 * for the authenticated player.
 *
 * This endpoint wraps the runTravelResolution() lib function, which is also
 * called directly by the command page server component.
 *
 * Body: {} (no body required — player identity comes from session cookie)
 * Returns: { ok: true, data: TravelResolutionResult }
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { runTravelResolution } from "@/lib/game/travelResolution";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const admin = createAdminClient();
  const result = await runTravelResolution(admin, player.id);

  return Response.json({ ok: true, data: result });
}
