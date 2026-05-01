/**
 * POST /api/game/ship/rename
 *
 * Renames a ship owned by the player.
 *
 * Body: { shipId: string; name: string }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

export const dynamic = "force-dynamic";

const RenameSchema = z.object({
  shipId: z.string().uuid(),
  name: z.string().trim().min(1, "Name cannot be empty.").max(32, "Name too long (max 32 characters)."),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await req.json().catch(() => ({}));
  const input = parseInput(RenameSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { shipId, name } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: ship } = maybeSingleResult<{ id: string; owner_id: string }>(
    await admin.from("ships").select("id, owner_id").eq("id", shipId).maybeSingle(),
  );

  if (!ship) return toErrorResponse(fail("not_found", "Ship not found.").error);
  if (ship.owner_id !== player.id) return toErrorResponse(fail("forbidden", "You do not own this ship.").error);

  await admin.from("ships").update({ name }).eq("id", shipId);

  return Response.json({ ok: true, data: { name } });
}
