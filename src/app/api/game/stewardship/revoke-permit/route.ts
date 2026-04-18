/**
 * POST /api/game/stewardship/revoke-permit
 *
 * Allows the steward of a body to revoke an active colony permit.
 * The grantee's colony remains but future extraction will no longer
 * have a deduction (engine tick skips revoked permits).
 *
 * Body: { permitId: string }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const RevokeSchema = z.object({
  permitId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(RevokeSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { permitId } = input.data;

  const admin = createAdminClient();

  const { data: permit } = maybeSingleResult<{
    id: string;
    steward_id: string;
    status: string;
  }>(
    await admin
      .from("colony_permits")
      .select("id, steward_id, status")
      .eq("id", permitId)
      .maybeSingle(),
  );

  if (!permit) {
    return toErrorResponse(fail("not_found", "Permit not found.").error);
  }
  if (permit.steward_id !== player.id) {
    return toErrorResponse(
      fail("forbidden", "Only the steward can revoke this permit.").error,
    );
  }
  if (permit.status === "revoked") {
    return Response.json({ ok: true }); // idempotent
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("colony_permits")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", permitId);

  return Response.json({ ok: true });
}
