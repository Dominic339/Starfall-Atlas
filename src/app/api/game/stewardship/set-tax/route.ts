/**
 * POST /api/game/stewardship/set-tax
 *
 * Allows the body steward or the system governor to set the default permit
 * tax rate on a planetary body.  If no body_stewardship row exists yet the
 * system governor can create one (establishing themselves as steward).
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

  // Derive system_id from body_id format "systemId:bodyIndex"
  const lastColon = bodyId.lastIndexOf(":");
  const systemId = lastColon > 0 ? bodyId.slice(0, lastColon) : null;

  const admin = createAdminClient();

  const { data: stewardship } = maybeSingleResult<{ steward_id: string }>(
    await admin
      .from("body_stewardship")
      .select("steward_id")
      .eq("body_id", bodyId)
      .maybeSingle(),
  );

  if (stewardship) {
    // Row exists — only the steward may update it
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
  } else {
    // No body stewardship row — only the system governor may create one
    if (!systemId) {
      return toErrorResponse(fail("not_found", "Invalid body ID format.").error);
    }
    const { data: sysSteward } = maybeSingleResult<{ steward_id: string }>(
      await admin
        .from("system_stewardship")
        .select("steward_id")
        .eq("system_id", systemId)
        .maybeSingle(),
    );
    if (!sysSteward || sysSteward.steward_id !== player.id) {
      return toErrorResponse(
        fail("forbidden", "Only the system governor can set tax on an unclaimed body.").error,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("body_stewardship")
      .upsert(
        { body_id: bodyId, system_id: systemId, steward_id: player.id, default_tax_rate_pct: taxRatePct },
        { onConflict: "body_id" },
      );
  }

  return Response.json({ ok: true });
}
