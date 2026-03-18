-- Phase 9: Colony Upkeep, Health, and Degradation
--
-- Adds upkeep tracking columns to the colonies table.
-- last_upkeep_at   — timestamp of the last period the colony was fully supplied.
-- upkeep_missed_periods — consecutive periods without full upkeep (iron).
--   0 = well_supplied, ≥1 = struggling, ≥3 = neglected.
--   Every 5 consecutive missed periods → tier loss (min tier 1), counter resets.
--
-- Back-fill: set last_upkeep_at = NOW() for all existing colonies so players
-- don't immediately inherit a debt on first login after this migration.

ALTER TABLE colonies
  ADD COLUMN IF NOT EXISTS last_upkeep_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS upkeep_missed_periods INTEGER NOT NULL DEFAULT 0;

-- Give all existing colonies a clean start.
UPDATE colonies
SET last_upkeep_at = NOW()
WHERE last_upkeep_at IS NULL;

-- Index to support the upkeep resolution query (fetch all active colonies
-- whose last_upkeep_at is overdue).
CREATE INDEX IF NOT EXISTS idx_colonies_upkeep
  ON colonies (owner_id, last_upkeep_at)
  WHERE status = 'active';
