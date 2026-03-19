-- ============================================================
-- Migration 00016: Model alignment — core station, Sol protection,
--                  ship dispatch mode, Sol stipend
--
-- Aligns the schema with the updated core model documented in
-- GAME_RULES.md §1.1, §21, §22 and SCHEMA_NOTES.md §4, §9.
--
-- Changes:
--   1. player_stations table (one core station per player)
--   2. players.sol_stipend_last_at (anti-softlock stipend tracking)
--   3. ships.dispatch_mode (manual / auto modes scaffold)
--   4. resource_inventory location_type extended to include 'station'
-- ============================================================

-- ============================================================
-- 1. Player core stations (GAME_RULES.md §21)
--
-- One station per player. Created automatically on first login
-- (alongside the player's starter ships). The station starts at
-- Sol and can be relocated in a future phase.
-- ============================================================

CREATE TABLE IF NOT EXISTS player_stations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Enforces the one-station-per-player invariant.
  owner_id            UUID NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  -- Current system. Updated when station movement resolves (future feature).
  -- Starts at 'sol' for all players.
  current_system_id   TEXT NOT NULL DEFAULT 'sol',
  skin_entitlement_id UUID,       -- FK to premium_entitlements (cosmetic; post-alpha)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_player_stations_updated_at
  BEFORE UPDATE ON player_stations
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE player_stations ENABLE ROW LEVEL SECURITY;

-- All authenticated players can read all station locations (public world state).
CREATE POLICY "authenticated_read_stations"
  ON player_stations FOR SELECT TO authenticated USING (TRUE);

CREATE INDEX IF NOT EXISTS idx_player_stations_owner
  ON player_stations (owner_id);

CREATE INDEX IF NOT EXISTS idx_player_stations_system
  ON player_stations (current_system_id);

-- ============================================================
-- 2. players.sol_stipend_last_at (GAME_RULES.md §22)
--
-- NULL = stipend has never been granted.
-- Updated to NOW() each time the Sol safety stipend fires.
-- The stipend is only granted when credits <= balance.solStipend.creditThreshold
-- and 24+ hours have elapsed since sol_stipend_last_at.
-- ============================================================

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS sol_stipend_last_at TIMESTAMPTZ;

-- ============================================================
-- 3. ships.dispatch_mode (GAME_RULES.md §1.2, SCHEMA_NOTES.md §9)
--
-- Scaffolds the ship automation model without implementing behavior.
-- All existing ships default to 'manual'.
-- ============================================================

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS dispatch_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (dispatch_mode IN ('manual', 'auto_collect_nearest', 'auto_collect_highest'));

-- ============================================================
-- 4. resource_inventory: extend location_type to include 'station'
--
-- The player core station has its own inventory in this table,
-- following the same pattern as colony / ship / alliance_storage.
-- ============================================================

-- Drop the existing CHECK constraint and re-add with 'station' included.
ALTER TABLE resource_inventory
  DROP CONSTRAINT IF EXISTS resource_inventory_location_type_check;

ALTER TABLE resource_inventory
  ADD CONSTRAINT resource_inventory_location_type_check
    CHECK (location_type IN ('colony', 'ship', 'alliance_storage', 'station'));
