-- ============================================================
-- Migration 00029: Phase 26 — Profile System & Account Lifecycle
-- ============================================================

-- ── Profile fields on players ────────────────────────────────
-- Extend the players table with optional cosmetic / bio fields.
-- All new columns are nullable so existing rows are unaffected.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS title         TEXT         CHECK (char_length(title)  <= 64),
  ADD COLUMN IF NOT EXISTS bio           TEXT         CHECK (char_length(bio)    <= 512),
  ADD COLUMN IF NOT EXISTS banner_id     TEXT         CHECK (char_length(banner_id) <= 64),
  ADD COLUMN IF NOT EXISTS logo_id       TEXT         CHECK (char_length(logo_id)   <= 64),
  -- Soft-delete: set when the player requests account deletion.
  -- Game-layout middleware redirects deactivated players to /deactivated.
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ DEFAULT NULL;

-- ── Handle character-set enforcement ────────────────────────
-- Enforce alphanumeric + underscore only (no spaces, no symbols).
-- The check on char_length already exists from migration 00002.
ALTER TABLE players
  ADD CONSTRAINT chk_handle_chars
    CHECK (handle ~ '^[A-Za-z0-9_]+$');

-- ── Index for public profile look-ups by handle ──────────────
CREATE INDEX IF NOT EXISTS idx_players_handle_lower
  ON players (lower(handle));

-- ── Index for active (non-deactivated) player look-ups ───────
CREATE INDEX IF NOT EXISTS idx_players_active
  ON players (id)
  WHERE deactivated_at IS NULL;
