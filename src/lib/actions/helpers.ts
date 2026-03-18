/**
 * Shared helpers for server-side game action handlers.
 */

import { z, ZodSchema } from "zod";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { singleResult } from "@/lib/supabase/utils";
import { fail, type ActionResult, type AuthContext } from "./types";
import type { Player, PlayerId } from "@/lib/types/game";
import type { ApiError } from "@/lib/types/api";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function requireAuth(): Promise<ActionResult<AuthContext>> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail("unauthorized", "You must be logged in to perform this action.");
  }

  const admin = createAdminClient();
  const { data: player, error } = singleResult<Player>(
    await admin.from("players").select("*").eq("auth_id", user.id).single(),
  );

  if (error || !player) {
    return fail(
      "not_found",
      "Player profile not found. Try logging out and back in.",
    );
  }

  return { ok: true, data: { authId: user.id, player } };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export function parseInput<T>(
  schema: ZodSchema<T>,
  raw: unknown,
): ActionResult<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    return fail("validation_error", "Invalid input.", {
      issues: result.error.issues,
    });
  }
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// Precondition checks
// ---------------------------------------------------------------------------

export function requireCredits(
  player: Player,
  amount: number,
): ActionResult<void> {
  if (player.credits < amount) {
    return fail(
      "insufficient_credits",
      `Insufficient credits. Required: ${amount}, available: ${player.credits}.`,
    );
  }
  return { ok: true, data: undefined };
}

export function requireColonySlot(
  player: Player,
  currentColonyCount: number,
): ActionResult<void> {
  if (currentColonyCount >= player.colony_slots) {
    return fail(
      "colony_limit_reached",
      `Colony limit reached (${player.colony_slots}). ` +
        "Earn more slots through gameplay or a Colony Permit.",
    );
  }
  return { ok: true, data: undefined };
}

export function requireShipOwner(
  shipOwnerId: PlayerId,
  playerId: PlayerId,
): ActionResult<void> {
  if (shipOwnerId !== playerId) {
    return fail("forbidden", "You do not own this ship.");
  }
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------

export function toErrorResponse(error: ApiError): Response {
  const status =
    error.code === "unauthorized" ? 401
    : error.code === "forbidden" ? 403
    : error.code === "not_found" ? 404
    : error.code === "validation_error" ? 400
    : error.code === "not_implemented" ? 501
    : 422;

  return Response.json({ ok: false, error }, { status });
}
