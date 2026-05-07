/**
 * POST /api/game/fleet/rename
 *
 * Renames a fleet owned by the player.
 *
 * Body: { fleetId: string; name: string }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

export const dynamic = "force-dynamic";

const RenameSchema = z.object({
  fleetId: z.string().uuid(),
  name: z.string().trim().min(1, "Name cannot be empty.").max(32, "Name too long (max 32 characters)."),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await req.json().catch(() => ({}));
  const input = parseInput(RenameSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { fleetId, name } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: fleet } = maybeSingleResult<{ id: string; player_id: string }>(
    await admin.from("fleets").select("id, player_id").eq("id", fleetId).maybeSingle(),
  );

  if (!fleet) return toErrorResponse(fail("not_found", "Fleet not found.").error);
  if (fleet.player_id !== player.id) return toErrorResponse(fail("forbidden", "You do not own this fleet.").error);

  await admin.from("fleets").update({ name }).eq("id", fleetId);

  return Response.json({ ok: true, data: { name } });
}
