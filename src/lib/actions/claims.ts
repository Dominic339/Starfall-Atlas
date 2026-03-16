/**
 * Claim action: a player claims a body for a colony.
 * Implementation status: structure complete; DB transaction TODO(phase-5).
 */

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult, maybeSingleResult } from "@/lib/supabase/utils";
import { requireAuth, parseInput, requireColonySlot } from "./helpers";
import { fail, type ActionResult } from "./types";
import type { ClaimBodyResult } from "@/lib/types/api";

const claimBodySchema = z.object({
  shipId: z.string().uuid("shipId must be a valid UUID"),
  bodyId: z.string().min(1, "bodyId is required"),
});

type ShipRow = {
  id: string;
  owner_id: string;
  current_body_id: string | null;
  current_system_id: string | null;
};

export async function claimBody(
  rawInput: unknown,
): Promise<ActionResult<ClaimBodyResult>> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;
  const { player } = authResult.data;

  const inputResult = parseInput(claimBodySchema, rawInput);
  if (!inputResult.ok) return inputResult;
  const { shipId, bodyId } = inputResult.data;

  const admin = createAdminClient();

  // Verify ship ownership
  const { data: ship, error: shipError } = singleResult<ShipRow>(
    await admin
      .from("ships")
      .select("id, owner_id, current_body_id, current_system_id")
      .eq("id", shipId)
      .single(),
  );

  if (shipError || !ship) return fail("not_found", "Ship not found.");
  if (ship.owner_id !== player.id)
    return fail("forbidden", "You do not own this ship.");

  if (ship.current_body_id !== bodyId) {
    return fail(
      "invalid_target",
      "Your ship is not at the target body. Travel there first.",
    );
  }

  // Verify the player has surveyed this body
  const { data: surveyResult } = maybeSingleResult<{ id: string }>(
    await admin
      .from("survey_results")
      .select("id")
      .eq("body_id", bodyId)
      .maybeSingle(),
  );

  if (!surveyResult) {
    return fail(
      "invalid_target",
      "This body has not been surveyed. Survey it before claiming.",
    );
  }

  // Check colony slot availability
  const { count: colonyCount } = await admin
    .from("colonies")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", player.id);

  const slotCheck = requireColonySlot(player, colonyCount ?? 0);
  if (!slotCheck.ok) return slotCheck;

  // Non-atomic existence check — replaced by SELECT FOR UPDATE in TODO(phase-5)
  const { data: existingColony } = maybeSingleResult<{ id: string }>(
    await admin
      .from("colonies")
      .select("id")
      .eq("body_id", bodyId)
      .maybeSingle(),
  );

  if (existingColony) {
    return fail("already_exists", "This body has already been claimed.");
  }

  // TODO(phase-5): Insert colony inside a SELECT FOR UPDATE transaction.
  return fail(
    "not_implemented",
    "Colony claim transaction not yet implemented. Coming in Phase 5.",
  );
}
