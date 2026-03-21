/**
 * POST /api/game/colony/route/delete
 *
 * Deletes a colony supply route owned by the authenticated player.
 *
 * Body:   { routeId: string }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import type { ColonyRoute } from "@/lib/types/game";

const DeleteRouteSchema = z.object({
  routeId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(DeleteRouteSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { routeId } = input.data;

  const admin = createAdminClient();

  // ── Verify ownership ──────────────────────────────────────────────────────
  const { data: route } = maybeSingleResult<Pick<ColonyRoute, "id" | "player_id">>(
    await admin
      .from("colony_routes")
      .select("id, player_id")
      .eq("id", routeId)
      .maybeSingle(),
  );

  if (!route) {
    return toErrorResponse(fail("not_found", "Route not found.").error);
  }
  if (route.player_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You do not own this route.").error);
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("colony_routes")
    .delete()
    .eq("id", routeId);

  return Response.json({ ok: true });
}
