-- ============================================================
-- Migration 00040: Colony slots expansion
--
-- The original default of colony_slots = 1 is far too low for
-- the intended logistics-network gameplay. Players need room to
-- build out multi-system colony networks before hitting a wall.
--
-- New progression:
--   Base (default)   : 20 slots
--   Upgrade 1        : 30 slots  (future milestone)
--   Upgrade 2        : 40 slots  (future milestone)
--   Unlimited tier   : 9999      (sentinel — effectively uncapped)
--
-- This migration:
--   1. Changes the column default to 20 for all new players
--   2. Raises every existing player to at least 20 slots
--      (does not reduce anyone who already has > 20)
-- ============================================================

-- 1. Update the column default
ALTER TABLE players
  ALTER COLUMN colony_slots SET DEFAULT 20;

-- 2. Bring all existing players up to the new base floor
UPDATE players
SET colony_slots = 20
WHERE colony_slots < 20;

NOTIFY pgrst, 'reload schema';
