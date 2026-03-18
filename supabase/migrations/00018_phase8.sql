-- ============================================================
-- Migration 00018: Phase 8 — ship automation modes
--
-- 1. Add auto_state column to ships (tracks which step of the
--    collect-and-return cycle the ship is in).
-- 2. Add auto_target_colony_id FK (which colony the ship is
--    currently targeting in its automation cycle).
-- 3. Index for efficient auto-ship dashboard resolution.
-- ============================================================

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS auto_state TEXT DEFAULT NULL
    CONSTRAINT ships_auto_state_check CHECK (
      auto_state IS NULL OR
      auto_state IN ('idle', 'traveling_to_colony', 'traveling_to_station')
    ),
  ADD COLUMN IF NOT EXISTS auto_target_colony_id UUID DEFAULT NULL
    REFERENCES colonies(id) ON DELETE SET NULL;

-- Index used when dashboard resolves all auto ships for a player.
CREATE INDEX IF NOT EXISTS idx_ships_auto
  ON ships (owner_id, dispatch_mode)
  WHERE dispatch_mode IN ('auto_collect_nearest', 'auto_collect_highest');
