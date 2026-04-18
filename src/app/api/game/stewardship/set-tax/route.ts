/**
 * POST /api/game/stewardship/set-tax
 *
 * Allows the steward of a body to update the default permit tax rate.
 * The rate is applied automatically when a non-steward founds a colony
 * on this body (colony/found auto-creates a colony_permits row).
 *
 * Body: { bodyId: string, taxRatePct: number (0–50) }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const SetTaxSchema = z.object({
  bodyId:     z.string().min(1).max(128),
  taxRatePct: z.number().int().min(0).max(50),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(SetTaxSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { bodyId, taxRatePct } = input.data;

  const admin = createAdminClient();

  const { data: stewardship } = maybeSingleResult<{ steward_id: string }>(
    await admin
      .from("body_stewardship")
      .select("steward_id")
      .eq("body_id", bodyId)
      .maybeSingle(),
  );

  if (!stewardship) {
    return toErrorResponse(
      fail("not_found", "No stewardship record found for this body.").error,
    );
  }
  if (stewardship.steward_id !== player.id) {
    return toErrorResponse(
      fail("forbidden", "Only the steward of this body can set the tax rate.").error,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("body_stewardship")
    .update({ default_tax_rate_pct: taxRatePct })
    .eq("body_id", bodyId);

  return Response.json({ ok: true });
}
