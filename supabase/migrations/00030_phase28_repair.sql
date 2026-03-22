-- ============================================================
-- Migration 00030: Phase 28 — Schema repair & data cleanup
--
-- PURPOSE: Idempotent catch-up migration for Supabase instances
-- where some earlier migrations (00014–00019) were not applied.
--
-- All DDL statements use IF NOT EXISTS / DO$$...EXCEPTION guards
-- so this migration is safe to re-run even when columns/tables
-- already exist.
--
-- CONFIRMED MISSING (from runtime error):
--   colonies.last_extract_at  (00017)
--
-- POSSIBLY MISSING (added defensively):
--   colonies.status, abandoned_at, collapsed_at  (00014)
--   colonies.last_upkeep_at, upkeep_missed_periods  (00019)
--   ships.dispatch_mode  (00016)
--   ships.auto_state, auto_target_colony_id  (00018)
--   player_stations table  (00016)
--   alliances.tag, invite_code  (00027)
--   players profile + lifecycle columns  (00029)
--
-- DATA REPAIR:
--   1. Backfill NULL timestamps on colonies
--   2. Create missing player_stations for all active players
--   3. Remove duplicate starter ships (keep oldest 2 per player)
-- ============================================================

-- ── 0. colony_status enum (safe if already exists) ───────────────────────

DO $$
BEGIN
  CREATE TYPE colony_status AS ENUM ('active', 'abandoned', 'collapsed');
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already created by migration 00014 — skip
END;
$$;

-- ── 1. colonies: lifecycle columns (from 00014, 00017, 00019) ────────────

ALTER TABLE colonies
  ADD COLUMN IF NOT EXISTS status               colony_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS abandoned_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS collapsed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_extract_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_upkeep_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS upkeep_missed_periods INTEGER NOT NULL DEFAULT 0;

-- Backfill any NULL timestamps so game logic has a valid baseline
UPDATE colonies SET last_extract_at = created_at WHERE last_extract_at IS NULL;
UPDATE colonies SET last_upkeep_at  = NOW()       WHERE last_upkeep_at  IS NULL;

-- Idempotent constraint adds (only added if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_colony_abandoned_at' AND conrelid = 'colonies'::regclass
  ) THEN
    ALTER TABLE colonies
      ADD CONSTRAINT chk_colony_abandoned_at
        CHECK (status != 'abandoned' OR abandoned_at IS NOT NULL);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_colony_collapsed_at' AND conrelid = 'colonies'::regclass
  ) THEN
    ALTER TABLE colonies
      ADD CONSTRAINT chk_colony_collapsed_at
        CHECK (status != 'collapsed' OR collapsed_at IS NOT NULL);
  END IF;
END;
$$;

-- Indexes for extraction and upkeep resolution queries
CREATE INDEX IF NOT EXISTS idx_colonies_extract
  ON colonies (owner_id, last_extract_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_colonies_upkeep
  ON colonies (owner_id, last_upkeep_at)
  WHERE status = 'active';

-- ── 2. ships: automation columns (from 00016, 00018) ─────────────────────

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS dispatch_mode TEXT NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  -- Add CHECK constraint only if missing (idempotent)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ships_dispatch_mode_check' AND conrelid = 'ships'::regclass
  ) THEN
    ALTER TABLE ships
      ADD CONSTRAINT ships_dispatch_mode_check
        CHECK (dispatch_mode IN ('manual', 'auto_collect_nearest', 'auto_collect_highest'));
  END IF;
END;
$$;

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS auto_state            TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_target_colony_id UUID DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ships_auto_state_check' AND conrelid = 'ships'::regclass
  ) THEN
    ALTER TABLE ships
      ADD CONSTRAINT ships_auto_state_check
        CHECK (auto_state IS NULL OR
               auto_state IN ('idle', 'traveling_to_colony', 'traveling_to_station'));
  END IF;
END;
$$;

-- Index for efficient auto-ship resolution on dashboard load
CREATE INDEX IF NOT EXISTS idx_ships_auto
  ON ships (owner_id, dispatch_mode)
  WHERE dispatch_mode IN ('auto_collect_nearest', 'auto_collect_highest');

-- ── 3. player_stations table (from 00016) ────────────────────────────────

CREATE TABLE IF NOT EXISTS player_stations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One station per player enforced by UNIQUE constraint.
  owner_id            UUID NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  current_system_id   TEXT NOT NULL DEFAULT 'sol',
  skin_entitlement_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger (guard: only create if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_player_stations_updated_at'
      AND tgrelid = 'player_stations'::regclass
  ) THEN
    CREATE TRIGGER set_player_stations_updated_at
      BEFORE UPDATE ON player_stations
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END;
$$;

-- RLS (safe to run even if already enabled)
ALTER TABLE player_stations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'player_stations'
      AND policyname = 'authenticated_read_stations'
  ) THEN
    CREATE POLICY "authenticated_read_stations"
      ON player_stations FOR SELECT TO authenticated USING (TRUE);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_player_stations_owner
  ON player_stations (owner_id);

CREATE INDEX IF NOT EXISTS idx_player_stations_system
  ON player_stations (current_system_id);

-- ── 4. players: profile & lifecycle columns (from 00016, 00029) ──────────

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS sol_stipend_last_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS title               TEXT,
  ADD COLUMN IF NOT EXISTS bio                 TEXT,
  ADD COLUMN IF NOT EXISTS banner_id           TEXT,
  ADD COLUMN IF NOT EXISTS logo_id             TEXT,
  ADD COLUMN IF NOT EXISTS deactivated_at      TIMESTAMPTZ;

-- ── 5. alliances: tag and invite_code (from 00027) ───────────────────────

ALTER TABLE alliances
  ADD COLUMN IF NOT EXISTS tag         TEXT,
  ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- Backfill any NULL values (safe for empty tables)
UPDATE alliances
  SET tag = UPPER(LEFT(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'), 4))
  WHERE tag IS NULL;

UPDATE alliances
  SET invite_code = LOWER(LEFT(gen_random_uuid()::TEXT, 8))
  WHERE invite_code IS NULL;

-- Unique index on tag (case-insensitive) — idempotent
CREATE UNIQUE INDEX IF NOT EXISTS idx_alliances_tag
  ON alliances (lower(tag));

-- ── 6. DATA REPAIR: create missing player_stations ───────────────────────
--
-- Inserts one "Command Station" at Sol for every player who has no station.
-- Uses ON CONFLICT DO NOTHING for full safety (UNIQUE owner_id prevents
-- duplicate stations even under concurrent execution).
--
-- Note: players with deactivated_at set are included intentionally —
-- they may reactivate, and bootstrap will check for the station on login.

INSERT INTO player_stations (owner_id, name, current_system_id)
SELECT p.id, 'Command Station', 'sol'
FROM   players p
WHERE  NOT EXISTS (
  SELECT 1 FROM player_stations ps WHERE ps.owner_id = p.id
)
ON CONFLICT (owner_id) DO NOTHING;

-- ── 7. DATA REPAIR: remove duplicate starter ships ───────────────────────
--
-- The Phase 26 bootstrap bug (invalid .eq("status","active") filter on ships)
-- caused ships to be created on every page load rather than only once.
-- Each affected player may have dozens of duplicate "Pioneer I" / "Pioneer II"
-- ships beyond the intended 2.
--
-- Strategy: keep the 2 oldest ships per player (the original starters),
-- delete everything beyond position 2 in ascending created_at order.
--
-- This is safe because:
--   - No gameplay mechanism yet allows acquiring more than 2 ships
--   - Upgrades (hull_level etc.) are applied to the oldest ships first
--   - Fleet memberships, travel jobs, and cargo reference ship IDs;
--     cascades or SET NULL on FK ensure integrity
--
-- Resource inventory rows for deleted ships are removed via ON DELETE CASCADE
-- if the FK is set up that way, or explicitly cleaned up below.

-- Step A: identify ships to delete (row_number > 2 per owner)
CREATE TEMP TABLE IF NOT EXISTS _ships_to_delete AS
SELECT id
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at ASC) AS rn
  FROM ships
) ranked
WHERE rn > 2;

-- Step B: clean up resource_inventory rows for these ships
DELETE FROM resource_inventory
WHERE location_type = 'ship'
  AND location_id IN (SELECT id FROM _ships_to_delete);

-- Step C: delete the excess ships themselves
DELETE FROM ships
WHERE id IN (SELECT id FROM _ships_to_delete);

DROP TABLE IF EXISTS _ships_to_delete;

-- ── 8. Refresh PostgREST schema cache ────────────────────────────────────
--
-- When run via the Supabase dashboard SQL editor, this causes PostgREST
-- to reload its schema cache immediately so that newly added columns are
-- visible to the application without restarting the project.

NOTIFY pgrst, 'reload schema';
