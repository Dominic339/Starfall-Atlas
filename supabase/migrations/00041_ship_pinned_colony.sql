-- ============================================================
-- Migration 00041: Ship pinned-colony assignment
--
-- Adds a player-settable pinned_colony_id to ships so that the
-- owner can explicitly assign a ship to haul from a specific
-- colony. This is separate from auto_target_colony_id, which is
-- a transient field set/cleared by the auto-haul state machine.
--
-- Behaviour:
--   - pinned_colony_id = NULL  → auto-haul uses nearest/highest logic
--   - pinned_colony_id set     → auto-haul prefers that colony first
--   - Switching mode (manual ↔ auto) does NOT clear the assignment
--   - Deleting a colony sets pinned_colony_id = NULL via FK cascade
-- ============================================================

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS pinned_colony_id UUID
    REFERENCES colonies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ships_pinned_colony
  ON ships (pinned_colony_id)
  WHERE pinned_colony_id IS NOT NULL;
