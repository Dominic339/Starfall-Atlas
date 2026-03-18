/**
 * Player bootstrap — idempotent first-login initialization.
 *
 * Called from the game layout on every authenticated page load.
 * On first call it creates the player row and starter ship.
 * On all subsequent calls it returns the existing player instantly.
 *
 * Race-safety: the DB UNIQUE constraint on players(auth_id) ensures
 * only one player row is ever created, even if two concurrent requests
 * reach this function at the same time.
 *
 * Sol handling: Sol is a canonical starter system defined as a constant.
 * It is NOT represented as a normal player discovery or stewardship row.
 * Starter ships are simply placed at SOL_SYSTEM_ID.
 */

import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, singleResult } from "@/lib/supabase/utils";
import {
  SOL_SYSTEM_ID,
  STARTER_SHIPS,
  STARTER_STATION_NAME,
  HANDLE_MIN_LENGTH,
  HANDLE_MAX_LENGTH,
} from "@/lib/config/constants";
import type { Player } from "@/lib/types/game";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the authenticated user has a player profile and starter ship.
 * Safe to call on every request — returns the existing player if already set up.
 *
 * Throws only on hard infrastructure failures (DB unavailable, both insert
 * attempts exhausted). All expected race conditions are handled gracefully.
 */
export async function bootstrapPlayer(user: User): Promise<Player> {
  const admin = createAdminClient();

  // ── Fast path: player already exists (all returning users) ────────────────
  const { data: existing } = maybeSingleResult<Player>(
    await admin
      .from("players")
      .select("*")
      .eq("auth_id", user.id)
      .maybeSingle(),
  );

  if (existing) return existing;

  // ── New player: derive handle and insert ──────────────────────────────────
  const preferredHandle = sanitizeHandle(user.user_metadata?.handle);
  const handle = preferredHandle ?? generateFallbackHandle(user.id);

  // Attempt insert with preferred handle.
  // Supabase returns data=null without throwing when a unique constraint fires,
  // so we can safely inspect the result without a try/catch.
  //
  // The admin client is untyped (no Database generic), so insert values must
  // be cast to `any`. This is intentional and consistent with singleResult<T>
  // / maybeSingleResult<T> — see lib/supabase/utils.ts for context.
  // TODO: remove `as any` after `supabase gen types typescript` is wired up.
  const { data: inserted } = maybeSingleResult<Player>(
    await admin
      .from("players")
      .insert({ auth_id: user.id, handle } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .select("*")
      .maybeSingle(),
  );

  if (inserted) {
    await createStarterAssets(inserted.id);
    return inserted;
  }

  // ── Insert failed — determine why ─────────────────────────────────────────

  // Case 1: auth_id conflict — a concurrent request created the row first.
  const { data: raced } = maybeSingleResult<Player>(
    await admin
      .from("players")
      .select("*")
      .eq("auth_id", user.id)
      .maybeSingle(),
  );
  if (raced) return raced;

  // Case 2: handle conflict — the preferred handle is already taken.
  // Retry with a deterministic fallback derived from the user ID.
  const fallbackHandle = generateFallbackHandle(user.id);

  const { data: fallbackInserted, error: fallbackError } =
    singleResult<Player>(
      await admin
        .from("players")
        .insert({ auth_id: user.id, handle: fallbackHandle } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .select("*")
        .single(),
    );

  if (!fallbackInserted) {
    throw new Error(
      `[starfall] Player bootstrap failed for auth_id=${user.id}. ` +
        `Fallback handle insert error: ${String(fallbackError)}`,
    );
  }

  await createStarterAssets(fallbackInserted.id);
  return fallbackInserted;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function createStarterAssets(playerId: string): Promise<void> {
  const admin = createAdminClient();

  // Create 2 starter ships at Sol
  await admin.from("ships").insert(
    STARTER_SHIPS.map((ship) => ({
      owner_id: playerId,
      name: ship.name,
      speed_ly_per_hr: ship.speedLyPerHr,
      cargo_cap: ship.cargoCap,
      current_system_id: SOL_SYSTEM_ID,
      current_body_id: null,
    })) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  );

  // Create core station at Sol
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("player_stations").insert({
    owner_id: playerId,
    name: STARTER_STATION_NAME,
    current_system_id: SOL_SYSTEM_ID,
  });
}

/**
 * Validate and trim a handle from user metadata.
 * Returns null if the handle is absent, too short, or too long.
 * Does not enforce character-set rules beyond what the DB enforces (length only).
 */
function sanitizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, HANDLE_MAX_LENGTH);
  if (trimmed.length < HANDLE_MIN_LENGTH) return null;
  return trimmed;
}

/**
 * Generate a deterministic fallback handle from a user UUID.
 * Format: "pilot_<first 10 hex chars of UUID without dashes>"
 * Example: "pilot_f47ac10b8e" — ~10^12 possible values; negligible collision risk at alpha scale.
 */
function generateFallbackHandle(userId: string): string {
  const hex = userId.replace(/-/g, "").slice(0, 10);
  return `pilot_${hex}`;
}
