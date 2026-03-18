/**
 * Shared result types for all server-side game actions.
 *
 * Pattern: every action returns ActionResult<T>.
 * Callers check result.ok before accessing result.data or result.error.
 *
 * ActionResult maps to ApiResult in src/lib/types/api.ts — they use the same
 * shape so action results can be forwarded directly from Route Handlers.
 */

import type { ApiError, GameErrorCode } from "@/lib/types/api";
import type { Player } from "@/lib/types/game";

// Re-export for convenience so action files only need one import
export type { ApiError, GameErrorCode };

// ---------------------------------------------------------------------------
// Core result type
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  code: GameErrorCode,
  message: string,
  details?: Record<string, unknown>,
): { ok: false; error: ApiError } {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}

// ---------------------------------------------------------------------------
// Auth context: the resolved player for a request
// ---------------------------------------------------------------------------

export interface AuthContext {
  /** Supabase auth UID */
  authId: string;
  /** Resolved player row */
  player: Player;
}
