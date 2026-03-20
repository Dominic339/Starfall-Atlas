-- Phase 12: Fleet Foundation and Manual Fleet Dispatch
--
-- Adds:
--   fleets        — fleet header (player-owned grouping of co-located ships)
--   fleet_ships   — join table linking ships to their fleet (UNIQUE ship_id enforces one fleet per ship)
--   travel_jobs.fleet_id — nullable FK linking a travel job to the fleet that dispatched it

-- ── Fleets ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleets (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  -- 'active'    = ships are co-located at current_system_id (staged or post-arrival)
  -- 'traveling' = ships have pending travel jobs en route to a destination
  -- 'disbanded' = fleet dissolved; fleet_ships rows deleted; ships freed
  status           TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'traveling', 'disbanded')),
  -- Current system when status='active'. NULL while traveling.
  current_system_id TEXT,
  disbanded_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Fleet Ships (join table) ──────────────────────────────────────────────────
-- UNIQUE (ship_id) ensures a ship belongs to at most one fleet at a time.
CREATE TABLE IF NOT EXISTS fleet_ships (
  fleet_id  UUID        NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
  ship_id   UUID        NOT NULL REFERENCES ships(id)  ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (fleet_id, ship_id),
  UNIQUE (ship_id)
);

-- ── Extend travel_jobs ────────────────────────────────────────────────────────
ALTER TABLE travel_jobs
  ADD COLUMN IF NOT EXISTS fleet_id UUID REFERENCES fleets(id);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fleets_player_active
  ON fleets (player_id)
  WHERE status != 'disbanded';

CREATE INDEX IF NOT EXISTS idx_fleet_ships_fleet
  ON fleet_ships (fleet_id);

CREATE INDEX IF NOT EXISTS idx_travel_jobs_fleet
  ON travel_jobs (fleet_id)
  WHERE fleet_id IS NOT NULL;

-- ── Row-level security ────────────────────────────────────────────────────────
ALTER TABLE fleets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_ships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fleets_select_own" ON fleets
  FOR SELECT USING (player_id = auth.uid()::uuid);

CREATE POLICY "fleet_ships_select_own" ON fleet_ships
  FOR SELECT USING (
    fleet_id IN (SELECT id FROM fleets WHERE player_id = auth.uid()::uuid)
  );
