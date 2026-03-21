-- Phase 15: Resource System, Colony Inventory, and Supply Routing
--
-- Changes:
--   1. Extend resource_inventory.quantity to BIGINT
--   2. Extend resource_inventory.location_type CHECK to allow 'station' if not already
--      (already done in 00016 — this migration is idempotent)
--   3. Create colony_routes table (inter-colony supply routing)
--   4. Create colony_transports table (transport unit at a colony)

-- ── 1. Widen quantity column to BIGINT ────────────────────────────────────────
ALTER TABLE resource_inventory
  ALTER COLUMN quantity TYPE BIGINT;

-- ── 2. Colony routes: automated resource transfers between colonies ────────────
CREATE TABLE IF NOT EXISTS colony_routes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  from_colony_id   UUID NOT NULL REFERENCES colonies(id) ON DELETE CASCADE,
  to_colony_id     UUID NOT NULL REFERENCES colonies(id) ON DELETE CASCADE,
  resource_type    TEXT NOT NULL,
  -- Transfer mode: 'all' (everything), 'excess' (above threshold), 'fixed' (exact amount)
  mode             TEXT NOT NULL
                     CHECK (mode IN ('all', 'excess', 'fixed')),
  -- Used when mode = 'fixed'; NULL otherwise
  fixed_amount     INTEGER,
  -- How often to run (minutes)
  interval_minutes INTEGER NOT NULL
                     CHECK (interval_minutes >= 1),
  -- Timestamp of last successful run (used for lazy period resolution)
  last_run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT colony_routes_no_self CHECK (from_colony_id != to_colony_id)
);

CREATE INDEX IF NOT EXISTS idx_colony_routes_player ON colony_routes(player_id);
CREATE INDEX IF NOT EXISTS idx_colony_routes_from   ON colony_routes(from_colony_id);
CREATE INDEX IF NOT EXISTS idx_colony_routes_to     ON colony_routes(to_colony_id);

-- ── 3. Colony transports: transport units stationed at a colony ───────────────
-- Each colony needs at least one transport for supply routes to run.
CREATE TABLE IF NOT EXISTS colony_transports (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colony_id  UUID NOT NULL REFERENCES colonies(id) ON DELETE CASCADE,
  tier       SMALLINT NOT NULL DEFAULT 1
               CHECK (tier BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_colony_transports_colony ON colony_transports(colony_id);
