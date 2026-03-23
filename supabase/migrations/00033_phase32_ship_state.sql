-- Phase 32: Unified Ship State
--
-- Adds three columns to ships:
--   ship_state            TEXT  -- authoritative single-field state
--   last_known_system_id  TEXT  -- always populated (even while traveling)
--   destination_system_id TEXT  -- populated while traveling; NULL when docked
--
-- IMPORTANT: system IDs are catalog text keys, NOT UUID foreign keys to any
-- DB table. No REFERENCES clause is used here. Existing travel/routing code
-- continues to join via travel_jobs.to_system_id when needed.
--
-- Backfill logic is idempotent: only rows still at the DEFAULT are touched.

-- 1. Add columns (idempotent via IF NOT EXISTS)
ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS ship_state TEXT
    NOT NULL DEFAULT 'idle_at_station'
    CHECK (ship_state IN (
      'idle_at_station',
      'idle_in_system',
      'assigned',
      'traveling',
      'loading',
      'unloading',
      'surveying',
      'harvesting',
      'fleet_traveling'
    )),
  ADD COLUMN IF NOT EXISTS last_known_system_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS destination_system_id TEXT DEFAULT NULL;

-- 2. Backfill ship_state from existing dispatch_mode / auto_state / location
--    Only touches rows that are still at the default value so re-runs are safe.
UPDATE ships
SET ship_state =
  CASE
    WHEN auto_state IN ('traveling_to_colony', 'traveling_to_station')
      THEN 'traveling'
    WHEN auto_state = 'idle'
      THEN 'idle_at_station'
    WHEN auto_state IS NULL AND current_system_id IS NOT NULL
      THEN 'idle_at_station'
    WHEN auto_state IS NULL AND current_system_id IS NULL
      THEN 'traveling'
    ELSE 'idle_at_station'
  END
WHERE ship_state = 'idle_at_station';  -- guard: only update default rows

-- 3. Backfill last_known_system_id for docked ships
UPDATE ships
SET last_known_system_id = current_system_id
WHERE current_system_id IS NOT NULL
  AND last_known_system_id IS NULL;

-- 4. Backfill last_known_system_id for in-transit ships from travel_jobs
UPDATE ships s
SET last_known_system_id = (
  SELECT tj.from_system_id
  FROM travel_jobs tj
  WHERE tj.ship_id = s.id
    AND tj.status  = 'pending'
  ORDER BY tj.created_at DESC
  LIMIT 1
)
WHERE s.current_system_id IS NULL
  AND s.last_known_system_id IS NULL;

-- 5. Backfill destination_system_id for currently-traveling ships
UPDATE ships s
SET destination_system_id = (
  SELECT tj.to_system_id
  FROM travel_jobs tj
  WHERE tj.ship_id = s.id
    AND tj.status  = 'pending'
  ORDER BY tj.created_at DESC
  LIMIT 1
)
WHERE s.ship_state = 'traveling'
  AND s.destination_system_id IS NULL;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_ships_ship_state
  ON ships (ship_state);

CREATE INDEX IF NOT EXISTS idx_ships_owner_ship_state
  ON ships (owner_id, ship_state);

CREATE INDEX IF NOT EXISTS idx_ships_last_known_system
  ON ships (last_known_system_id)
  WHERE last_known_system_id IS NOT NULL;
