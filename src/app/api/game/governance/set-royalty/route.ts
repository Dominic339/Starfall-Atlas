/**
 * POST /api/game/governance/set-royalty
 *
 * Allows the current governance holder of a system to set the mining royalty
 * rate (0–20%) charged to non-governing extractors operating in that system.
 *
 * Governance holder = steward when stewardship.has_governance is TRUE,
 * or the confirmed majority controller otherwise.
 *
 * Body: { systemId: string, royaltyRatePct: number (0–20) }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";

const Schema = z.object({
  systemId:      z.string().min(1).max(64),
  royaltyRatePct: z.number().int().min(0).max(20),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { systemId, royaltyRatePct } = input.data;

  if (royaltyRatePct > BALANCE.alliances.royaltyCapPercent) {
    return toErrorResponse(
      fail("validation_error", `Royalty rate cannot exceed ${BALANCE.alliances.royaltyCapPercent}%.`).error,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: stewardRow } = maybeSingleResult<{ steward_id: string; has_governance: boolean }>(
    await admin
      .from("system_stewardship")
      .select("steward_id, has_governance")
      .eq("system_id", systemId)
      .maybeSingle(),
  );

  if (!stewardRow) {
    return toErrorResponse(fail("not_found", "No stewardship record for this system.").error);
  }

  // Resolve who currently holds governance
  let governanceHolderId: string;
  if (stewardRow.has_governance) {
    governanceHolderId = stewardRow.steward_id;
  } else {
    const { data: majorityRow } = maybeSingleResult<{ controller_id: string; is_confirmed: boolean }>(
      await admin
        .from("system_majority_control")
        .select("controller_id, is_confirmed")
        .eq("system_id", systemId)
        .maybeSingle(),
    );
    if (!majorityRow?.is_confirmed) {
      return toErrorResponse(fail("not_found", "Governance is currently uncontrolled.").error);
    }
    governanceHolderId = majorityRow.controller_id;
  }

  if (governanceHolderId !== player.id) {
    return toErrorResponse(
      fail("forbidden", "Only the current governance holder may set the royalty rate.").error,
    );
  }

  await admin
    .from("system_stewardship")
    .update({ royalty_rate: royaltyRatePct })
    .eq("system_id", systemId);

  return Response.json({ ok: true });
}
