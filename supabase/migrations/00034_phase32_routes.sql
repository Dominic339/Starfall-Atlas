-- Phase 32: Routes and Route Legs
--
-- Creates the routes and route_legs tables FIRST, then adds the
-- active_route_id FK column to ships. The FK constraint is intentionally
-- added AFTER the referenced table is created; this is the dependency-safe order.
--
-- Migration is idempotent via CREATE TABLE IF NOT EXISTS and
-- ADD COLUMN IF NOT EXISTS.

-- 1. Named logistics routes (one per player intent)
CREATE TABLE IF NOT EXISTS routes (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id            UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL DEFAULT '',
  route_type           TEXT        NOT NULL DEFAULT 'haul'
                         CHECK (route_type IN ('haul', 'survey', 'patrol', 'fleet_dispatch')),
  -- Where the route starts
  origin_type          TEXT        NOT NULL DEFAULT 'station'
                         CHECK (origin_type IN ('station', 'colony', 'system')),
  origin_id            TEXT        NOT NULL DEFAULT '',
  -- Where the route ends
  dest_type            TEXT        NOT NULL DEFAULT 'station'
                         CHECK (dest_type IN ('station', 'colony', 'system')),
  dest_id              TEXT        NOT NULL DEFAULT '',
  -- Automation policy (replaces per-ship dispatch_mode)
  haul_mode            TEXT        NOT NULL DEFAULT 'manual'
                         CHECK (haul_mode IN ('manual', 'auto_nearest', 'auto_highest', 'round_trip')),
  status               TEXT        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  -- Denormalised count for fast display; authoritative state is ships.active_route_id
  assigned_ship_count  INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Individual hops within a route
CREATE TABLE IF NOT EXISTS route_legs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id              UUID        NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  leg_index             INTEGER     NOT NULL,
  from_system_id        TEXT        NOT NULL,
  to_system_id          TEXT        NOT NULL,
  -- lane_id is NULL for same-system moves or direct warp
  lane_id               UUID        REFERENCES hyperspace_lanes(id) ON DELETE SET NULL,
  distance_ly           NUMERIC(8,4),
  estimated_duration_hr NUMERIC(8,4),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (route_id, leg_index)
);

-- 3. Add route assignment columns to ships
--    active_route_id FK is safe because routes table already exists above.
ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS active_route_id UUID
    REFERENCES routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_leg_index INTEGER NOT NULL DEFAULT 0;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_routes_player_status
  ON routes (player_id, status);

CREATE INDEX IF NOT EXISTS idx_route_legs_route_leg
  ON route_legs (route_id, leg_index);

CREATE INDEX IF NOT EXISTS idx_ships_active_route
  ON ships (active_route_id)
  WHERE active_route_id IS NOT NULL;

-- 5. Row-level security
ALTER TABLE routes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_legs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'routes' AND policyname = 'Players see own routes'
  ) THEN
    CREATE POLICY "Players see own routes"
      ON routes FOR ALL
      USING (
        player_id = (SELECT id FROM players WHERE auth_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'route_legs' AND policyname = 'Players see own route legs'
  ) THEN
    CREATE POLICY "Players see own route legs"
      ON route_legs FOR ALL
      USING (
        route_id IN (
          SELECT id FROM routes
          WHERE player_id = (SELECT id FROM players WHERE auth_id = auth.uid())
        )
      );
  END IF;
END;
$$;
