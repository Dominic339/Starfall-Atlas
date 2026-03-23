-- ============================================================
-- Migration 00038: Phase 33 — Schema stabilization (idempotent repair)
--
-- PURPOSE: Ensure DB instances that may have missed migrations 00016–00021
-- have the correct schema for Phase 32+ gameplay. All statements are
-- idempotent (IF NOT EXISTS / DROP … IF EXISTS).
--
-- FIXES:
--   1. resource_inventory.location_type constraint includes 'station'
--      (some DBs only ran 00007 and missed the extension in 00016)
--   2. ships stat-level columns (hull/engine/shield/utility/cargo/turret)
--      added with DEFAULT 1 if missing; defaults updated if stale
--   3. ships state/route columns (ship_state, last_known_system_id, etc.)
--      added if missing
--   4. RLS on resource_inventory extended to include 'station' rows
--   5. Backfill: existing ships raised to at least level 1; last_known_system_id
--      populated from current_system_id for docked ships
-- ============================================================

-- ── 1. Fix resource_inventory check constraint ────────────────────────────
-- Drop the old constraint (regardless of current values) and re-add with
-- the full set of valid location types.

ALTER TABLE resource_inventory
  DROP CONSTRAINT IF EXISTS resource_inventory_location_type_check;

ALTER TABLE resource_inventory
  ADD CONSTRAINT resource_inventory_location_type_check
    CHECK (location_type IN ('colony', 'ship', 'alliance_storage', 'station'));

-- ── 2. Ship stat-level columns (from migrations 00021, 00031, 00032) ──────

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS hull_level    INTEGER NOT NULL DEFAULT 1
    CHECK (hull_level    >= 0 AND hull_level    <= 10),
  ADD COLUMN IF NOT EXISTS shield_level  INTEGER NOT NULL DEFAULT 1
    CHECK (shield_level  >= 0 AND shield_level  <= 10),
  ADD COLUMN IF NOT EXISTS cargo_level   INTEGER NOT NULL DEFAULT 1
    CHECK (cargo_level   >= 0 AND cargo_level   <= 10),
  ADD COLUMN IF NOT EXISTS engine_level  INTEGER NOT NULL DEFAULT 1
    CHECK (engine_level  >= 0 AND engine_level  <= 10),
  ADD COLUMN IF NOT EXISTS turret_level  INTEGER NOT NULL DEFAULT 1
    CHECK (turret_level  >= 0 AND turret_level  <= 10),
  ADD COLUMN IF NOT EXISTS utility_level INTEGER NOT NULL DEFAULT 1
    CHECK (utility_level >= 0 AND utility_level <= 10);

-- Update defaults for columns that may have been added earlier with DEFAULT 0
ALTER TABLE ships
  ALTER COLUMN hull_level    SET DEFAULT 1,
  ALTER COLUMN engine_level  SET DEFAULT 1,
  ALTER COLUMN shield_level  SET DEFAULT 1,
  ALTER COLUMN utility_level SET DEFAULT 1,
  ALTER COLUMN cargo_level   SET DEFAULT 1,
  ALTER COLUMN turret_level  SET DEFAULT 1,
  ALTER COLUMN cargo_cap     SET DEFAULT 150,
  ALTER COLUMN speed_ly_per_hr SET DEFAULT 11.0;

-- Backfill existing ships: raise all stat levels to at least 1
UPDATE ships
SET
  hull_level    = GREATEST(hull_level,    1),
  engine_level  = GREATEST(engine_level,  1),
  shield_level  = GREATEST(shield_level,  1),
  utility_level = GREATEST(utility_level, 1),
  cargo_level   = GREATEST(cargo_level,   1),
  turret_level  = GREATEST(turret_level,  1);

-- ── 3. Ship automation columns (from migration 00016, 00018) ─────────────

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS dispatch_mode TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS auto_state            TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_target_colony_id UUID DEFAULT NULL;

-- ── 4. Ship state + route columns (from migrations 00033, 00034) ──────────

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS ship_state TEXT NOT NULL DEFAULT 'idle_at_station';

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS last_known_system_id  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS destination_system_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS route_leg_index       INTEGER NOT NULL DEFAULT 0;

-- Backfill last_known_system_id for docked ships
UPDATE ships
SET last_known_system_id = current_system_id
WHERE current_system_id IS NOT NULL
  AND last_known_system_id IS NULL;

-- ── 5. Fix RLS policy for resource_inventory (add 'station' arm) ──────────
-- Drop and recreate the select policy so it recognises player-owned stations.

DROP POLICY IF EXISTS "own_resource_inventory" ON resource_inventory;

CREATE POLICY "own_resource_inventory"
  ON resource_inventory FOR SELECT
  TO authenticated
  USING (
    (location_type = 'colony' AND EXISTS (
      SELECT 1 FROM colonies
      WHERE id = location_id AND owner_id = auth_player_id()
    )) OR
    (location_type = 'ship' AND EXISTS (
      SELECT 1 FROM ships
      WHERE id = location_id AND owner_id = auth_player_id()
    )) OR
    (location_type = 'alliance_storage' AND EXISTS (
      SELECT 1 FROM alliance_members
      WHERE alliance_id = location_id AND player_id = auth_player_id()
    )) OR
    (location_type = 'station' AND EXISTS (
      SELECT 1 FROM player_stations
      WHERE id = location_id AND owner_id = auth_player_id()
    ))
  );

-- ── 6. Ensure player_stations exists (defensive — may already exist) ──────
CREATE TABLE IF NOT EXISTS player_stations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  current_system_id   TEXT NOT NULL DEFAULT 'sol',
  skin_entitlement_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- ── 7. Create missing player_stations for existing players ────────────────
INSERT INTO player_stations (owner_id, name, current_system_id)
SELECT p.id, 'Command Station', 'sol'
FROM   players p
WHERE  NOT EXISTS (
  SELECT 1 FROM player_stations ps WHERE ps.owner_id = p.id
)
ON CONFLICT (owner_id) DO NOTHING;

-- ── 8. Refresh PostgREST schema cache ────────────────────────────────────
NOTIFY pgrst, 'reload schema';
