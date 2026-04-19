/**
 * POST /api/game/premium/deep-survey
 *
 * Consumes a Deep Survey Kit entitlement to reveal the rare/hidden
 * resource nodes on a body that a basic survey does not find.
 *
 * The body must already have a basic survey result. Deep nodes are
 * generated deterministically from the same seed — they are not random.
 *
 * Body: { entitlementId: string, bodyId: string }
 * Returns: { ok: true, data: { survey: SurveyResult } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import type { SurveyResult } from "@/lib/types/game";

const Schema = z.object({
  entitlementId: z.string().uuid(),
  bodyId:        z.string().min(1).max(128),
});

function parseBodyId(bodyId: string): { systemId: string; bodyIndex: number } | null {
  const lastColon = bodyId.lastIndexOf(":");
  if (lastColon === -1) return null;
  const systemId  = bodyId.slice(0, lastColon);
  const bodyIndex = parseInt(bodyId.slice(lastColon + 1), 10);
  if (!systemId || isNaN(bodyIndex) || bodyIndex < 0) return null;
  return { systemId, bodyIndex };
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { entitlementId, bodyId } = input.data;

  const parsed = parseBodyId(bodyId);
  if (!parsed) {
    return toErrorResponse(fail("validation_error", "Invalid bodyId format.").error);
  }
  const { systemId, bodyIndex } = parsed;

  const catalogEntry = getCatalogEntry(systemId);
  if (!catalogEntry) {
    return toErrorResponse(fail("not_found", `System '${systemId}' not found.`).error);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Validate entitlement ──────────────────────────────────────────────────
  const { data: entitlement } = maybeSingleResult<{
    id: string; player_id: string; item_type: string; consumed: boolean;
  }>(
    await admin
      .from("premium_entitlements")
      .select("id, player_id, item_type, consumed")
      .eq("id", entitlementId)
      .maybeSingle(),
  );
  if (!entitlement || entitlement.player_id !== player.id) {
    return toErrorResponse(fail("not_found", "Entitlement not found.").error);
  }
  if (entitlement.item_type !== "deep_survey_kit") {
    return toErrorResponse(fail("invalid_target", "This entitlement is not a Deep Survey Kit.").error);
  }
  if (entitlement.consumed) {
    return toErrorResponse(fail("already_exists", "This Deep Survey Kit has already been used.").error);
  }

  // ── Basic survey must already exist ───────────────────────────────────────
  const { data: existing } = maybeSingleResult<SurveyResult>(
    await admin.from("survey_results").select("*").eq("body_id", bodyId).maybeSingle(),
  );
  if (!existing) {
    return toErrorResponse(
      fail("invalid_target", "The body must have a basic survey before using a Deep Survey Kit.").error,
    );
  }
  if (existing.has_deep_nodes && (existing.deep_nodes as unknown[]).length > 0) {
    // Already has deep nodes — idempotent; just return existing result
    return Response.json({ ok: true, data: { survey: existing } });
  }

  // ── Generate deep nodes ───────────────────────────────────────────────────
  const generatedSystem = generateSystem(systemId, catalogEntry);
  const generatedBody   = generatedSystem.bodies[bodyIndex];

  if (!generatedBody) {
    return toErrorResponse(fail("not_found", `Body index ${bodyIndex} not found.`).error);
  }

  const deepNodes = generatedBody.deepResourceNodes.map((n: { type: string; quantity: number; isRare?: boolean }) => ({
    type:     n.type,
    quantity: n.quantity,
    is_rare:  true,
  }));

  // ── Update survey result + consume entitlement ────────────────────────────
  const now = new Date();
  await admin
    .from("survey_results")
    .update({ deep_nodes: deepNodes, has_deep_nodes: deepNodes.length > 0 })
    .eq("body_id", bodyId);

  await admin
    .from("premium_entitlements")
    .update({ consumed: true, consumed_at: now.toISOString() })
    .eq("id", entitlementId);

  const updated: SurveyResult = {
    ...existing,
    deep_nodes:     deepNodes,
    has_deep_nodes: deepNodes.length > 0,
  };

  return Response.json({ ok: true, data: { survey: updated } });
}
