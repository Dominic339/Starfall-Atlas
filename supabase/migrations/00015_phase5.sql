-- ============================================================
-- Migration 00015: Phase 5 — survey and colony founding support
--
-- Safe to apply on top of 00014.
-- All statements use IF NOT EXISTS / IF EXISTS guards so this
-- migration is idempotent on re-run.
-- ============================================================

-- ── players: add colony_permits_used if not present ───────────────────────
-- Tracks how many Colony Permit premium items the player has consumed
-- (each permit adds +1 colony slot). Separate from colony_slots which
-- is the total slot ceiling.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS colony_permits_used SMALLINT NOT NULL DEFAULT 0;

-- ── Indexes for Phase 5 query patterns ────────────────────────────────────

-- Survey results looked up by system (for system detail page bulk fetch)
CREATE INDEX IF NOT EXISTS idx_survey_results_system_id
  ON survey_results (system_id);

-- Survey results by body_id (already UNIQUE, but explicit index for fast lookup)
-- The UNIQUE constraint on body_id already creates an index; this is a no-op
-- on Postgres but harmless.
CREATE INDEX IF NOT EXISTS idx_survey_results_body_id
  ON survey_results (body_id);

-- Colonies by system_id (for system detail page + dashboard)
CREATE INDEX IF NOT EXISTS idx_colonies_system_id
  ON colonies (system_id);
