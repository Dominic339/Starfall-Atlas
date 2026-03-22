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
 *
 * Phase 28: reconcileStarterAssets now also detects and cleans up
 * duplicate ships created by the Phase 26 bootstrap bug. Any ships
 * beyond STARTER_SHIPS.length (oldest kept) are deleted.
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

  if (existing) {
    // Reconcile legacy accounts that may be missing starter assets
    await reconcileStarterAssets(admin, existing.id);
    return existing;
  }

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

/**
 * Reconcile starter assets for existing players.
 *
 * Canonical asset counts:
 *   - Ships: exactly STARTER_SHIPS.length (currently 2)
 *   - Stations: exactly 1
 *
 * Actions taken:
 *   - If 0 ships found (query success): create STARTER_SHIPS
 *   - If >STARTER_SHIPS.length ships found: delete excess (keep oldest N)
 *   - If 0 stations found: create starter station
 *
 * Safe to call on every request. All DB errors are swallowed to avoid
 * breaking page loads — errors are logged to server console only.
 */
async function reconcileStarterAssets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  playerId: string,
): Promise<void> {
  // ── Ships ──────────────────────────────────────────────────────────────────
  // Fetch ship IDs ordered by created_at so oldest are first (canonical).
  const { data: existingShips, error: shipsError } = await admin
    .from("ships")
    .select("id, created_at")
    .eq("owner_id", playerId)
    .order("created_at", { ascending: true });

  if (shipsError) {
    // Schema error or DB unavailable — skip to avoid creating more duplicates.
    console.error(`[bootstrap] ships query failed for player ${playerId}:`, shipsError);
  } else if (!existingShips || existingShips.length === 0) {
    // No ships at all — create canonical starter ships.
    const { error: insertErr } = await admin.from("ships").insert(
      STARTER_SHIPS.map((ship) => ({
        owner_id: playerId,
        name: ship.name,
        speed_ly_per_hr: ship.speedLyPerHr,
        cargo_cap: ship.cargoCap,
        hull_level: 1,
        engine_level: 1,
        shield_level: 1,
        utility_level: 1,
        cargo_level: 1,
        turret_level: 1,
        current_system_id: SOL_SYSTEM_ID,
        current_body_id: null,
      })) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    if (insertErr) {
      console.error(`[bootstrap] ship insert failed for player ${playerId}:`, insertErr);
    }
  } else if (existingShips.length > STARTER_SHIPS.length) {
    // More ships than the canonical count — Phase 26 bootstrap bug produced duplicates.
    // Keep the oldest STARTER_SHIPS.length ships, delete the rest.
    // The oldest ships are most likely to have had upgrades applied.
    const surplusIds = (existingShips as { id: string }[])
      .slice(STARTER_SHIPS.length)
      .map((s) => s.id);
    const { error: deleteErr } = await admin
      .from("ships")
      .delete()
      .in("id", surplusIds);
    if (deleteErr) {
      console.error(`[bootstrap] duplicate ship cleanup failed for player ${playerId}:`, deleteErr);
    } else {
      console.info(
        `[bootstrap] removed ${surplusIds.length} duplicate ship(s) for player ${playerId}`,
      );
    }
  }
  // If existingShips.length === STARTER_SHIPS.length, nothing to do.

  // ── Station ────────────────────────────────────────────────────────────────
  // player_stations has UNIQUE(owner_id) so at most one row can exist.
  // Use limit(1) for defensive safety only.
  const { data: stationRows, error: stationError } = await admin
    .from("player_stations")
    .select("id")
    .eq("owner_id", playerId)
    .limit(1);

  if (stationError) {
    // player_stations table may not exist yet — log but do not throw.
    console.error(`[bootstrap] station query failed for player ${playerId}:`, stationError);
  } else if (!stationRows || stationRows.length === 0) {
    // No station — create one. ON CONFLICT is not needed because the UNIQUE
    // constraint will silently reject a concurrent duplicate insert.
    const { error: stationInsertErr } = await admin.from("player_stations").insert({
      owner_id: playerId,
      name: STARTER_STATION_NAME,
      current_system_id: SOL_SYSTEM_ID,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (stationInsertErr) {
      // 23505 = unique violation (concurrent request created it first) — acceptable.
      const isRace = stationInsertErr.code === "23505";
      if (!isRace) {
        console.error(`[bootstrap] station insert failed for player ${playerId}:`, stationInsertErr);
      }
    }
  }
}

async function createStarterAssets(playerId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Create 2 starter ships at Sol (Phase 28: start at level 1 on key stats)
  await admin.from("ships").insert(
    STARTER_SHIPS.map((ship) => ({
      owner_id: playerId,
      name: ship.name,
      speed_ly_per_hr: ship.speedLyPerHr,
      cargo_cap: ship.cargoCap,
      hull_level: 1,
      engine_level: 1,
      shield_level: 1,
      utility_level: 1,
      cargo_level: 1,
      turret_level: 1,
      current_system_id: SOL_SYSTEM_ID,
      current_body_id: null,
    })),
  );

  // Create core station at Sol and retrieve its ID
  const { data: station } = await admin
    .from("player_stations")
    .insert({
      owner_id: playerId,
      name: STARTER_STATION_NAME,
      current_system_id: SOL_SYSTEM_ID,
    })
    .select("id")
    .single();

  // Phase 28: grant 900 starting iron in station inventory
  if (station?.id) {
    await admin.from("resource_inventory").upsert(
      {
        location_type: "station",
        location_id: station.id,
        resource_type: "iron",
        quantity: 900,
      },
      { onConflict: "location_type,location_id,resource_type" },
    );
  }
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
