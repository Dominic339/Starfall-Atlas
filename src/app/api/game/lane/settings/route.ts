/**
 * POST /api/game/lane/settings
 *
 * Update access level and/or transit tax rate on a lane the player owns.
 *
 * Body: { laneId, accessLevel?, transitTaxRate?, allianceId? }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";
import type { HyperspaceLane } from "@/lib/types/game";

const SettingsSchema = z.object({
  laneId:          z.string().uuid(),
  accessLevel:     z.enum(["public", "alliance_only", "private"]).optional(),
  transitTaxRate:  z.number().int().min(0).max(BALANCE.lanes.maxTransitTaxPercent).optional(),
  allianceId:      z.string().uuid().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(SettingsSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { laneId, accessLevel, transitTaxRate, allianceId } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: lane } = maybeSingleResult<HyperspaceLane>(
    await admin.from("hyperspace_lanes").select("owner_id, access_level").eq("id", laneId).maybeSingle(),
  );

  if (!lane) return toErrorResponse(fail("not_found", "Lane not found.").error);
  if (lane.owner_id !== player.id) return toErrorResponse(fail("forbidden", "You do not own this lane.").error);

  const patch: Record<string, unknown> = {};
  if (accessLevel     !== undefined) patch.access_level     = accessLevel;
  if (transitTaxRate  !== undefined) patch.transit_tax_rate = transitTaxRate;
  if (allianceId      !== undefined) patch.alliance_id      = allianceId;

  // Enforce: alliance_id required when switching to alliance_only
  const finalAccess = (accessLevel ?? lane.access_level) as string;
  if (finalAccess === "alliance_only" && !patch.alliance_id && !(lane as HyperspaceLane).alliance_id) {
    return toErrorResponse(fail("validation_error", "allianceId is required for alliance_only access.").error);
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ ok: true });
  }

  await admin.from("hyperspace_lanes").update(patch).eq("id", laneId);

  return Response.json({ ok: true });
}
