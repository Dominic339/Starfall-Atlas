-- Phase 20: Asteroid Events and Shared Harvest Nodes
--
-- Adds persistent, shared asteroid event nodes visible on the galaxy map.
-- Multiple players can harvest the same asteroid simultaneously; depletion
-- is shared and resolved lazily (not in real-time).
--
-- Tables:
--   1. asteroid_nodes   — persistent shared event nodes (one row per asteroid)
--   2. asteroid_harvests — active/completed harvest assignments (fleet → asteroid)
--
-- Design notes:
--   - asteroid_nodes are NOT player-owned; they are world objects.
--   - Any player with a fleet at the associated system may dispatch to harvest.
--   - harvest_power_per_hr is stored at dispatch time for deterministic lazy resolution.
--   - remaining_amount and last_resolved_at are updated on resolution.
--   - No RLS needed on asteroid_nodes (world-readable, admin-written).
--   - asteroid_harvests are player-owned and protected by RLS.

-- ── 1. asteroid_nodes ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asteroid_nodes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The catalog system this asteroid is associated with (backend region)
  system_id           TEXT        NOT NULL,

  -- UI display: SVG-space offset from the system node (set at creation)
  display_offset_x    FLOAT       NOT NULL DEFAULT 0,
  display_offset_y    FLOAT       NOT NULL DEFAULT 0,

  -- Resource this asteroid yields
  resource_type       TEXT        NOT NULL
                        CHECK (resource_type IN ('iron','carbon','silica','sulfur','rare_crystal')),

  -- Total capacity and current remaining stock
  total_amount        INTEGER     NOT NULL CHECK (total_amount > 0),
  remaining_amount    INTEGER     NOT NULL CHECK (remaining_amount >= 0),

  -- Lifecycle
  status              TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','depleted','expired')),

  -- Last time remaining_amount was reconciled from active harvests
  last_resolved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  spawned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = no expiry (lasts until depleted); set for time-limited events
  expires_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_asteroid_nodes_system   ON asteroid_nodes(system_id);
CREATE INDEX IF NOT EXISTS idx_asteroid_nodes_status   ON asteroid_nodes(status);

-- ── 2. asteroid_harvests ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asteroid_harvests (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  asteroid_id           UUID        NOT NULL REFERENCES asteroid_nodes(id) ON DELETE CASCADE,
  fleet_id              UUID        NOT NULL REFERENCES fleets(id)         ON DELETE CASCADE,
  player_id             UUID        NOT NULL REFERENCES players(id)        ON DELETE CASCADE,

  -- Units per hour this fleet contributes, computed from ship stats at dispatch time.
  -- Stored here so lazy resolution is deterministic without re-querying ships.
  harvest_power_per_hr  FLOAT       NOT NULL CHECK (harvest_power_per_hr > 0),

  -- Lifecycle
  status                TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','cancelled')),

  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Updated each time the harvest is lazily resolved (resources deposited)
  last_resolved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asteroid_harvests_asteroid ON asteroid_harvests(asteroid_id);
CREATE INDEX IF NOT EXISTS idx_asteroid_harvests_fleet    ON asteroid_harvests(fleet_id);
CREATE INDEX IF NOT EXISTS idx_asteroid_harvests_player   ON asteroid_harvests(player_id);
CREATE INDEX IF NOT EXISTS idx_asteroid_harvests_status   ON asteroid_harvests(status);

-- One active harvest per fleet (a fleet can only harvest one asteroid at a time)
CREATE UNIQUE INDEX IF NOT EXISTS idx_asteroid_harvests_fleet_active
  ON asteroid_harvests(fleet_id)
  WHERE status = 'active';

-- ── 3. Seed initial asteroid nodes ───────────────────────────────────────────
-- 10 starter asteroids spread across alpha-catalog systems.
-- Offsets place them visually offset from their system star node on the map.
-- total_amount values are per BALANCE.asteroids.initialAmountByResource.

INSERT INTO asteroid_nodes
  (system_id, display_offset_x, display_offset_y, resource_type, total_amount, remaining_amount)
VALUES
  -- Sol region
  ('sol',             22,  -18, 'iron',         500, 500),
  ('sol',            -28,   20, 'carbon',        400, 400),
  -- Alpha Centauri region
  ('alpha_centauri',  20,  -22, 'iron',         500, 500),
  ('alpha_centauri', -24,   16, 'silica',       350, 350),
  -- Barnard's Star
  ('barnards_star',   18,  -15, 'carbon',        400, 400),
  ('barnards_star',  -20,   22, 'sulfur',       300, 300),
  -- Sirius
  ('sirius',          26,   14, 'iron',         500, 500),
  -- Procyon
  ('procyon',        -22,  -18, 'silica',       350, 350),
  -- Epsilon Eridani (sulfur-heavy, harsh region)
  ('epsilon_eridani', 20,  -20, 'sulfur',       300, 300),
  -- Wolf 359 (rare node — lower yield)
  ('wolf_359',        16,   16, 'rare_crystal', 150, 150)
ON CONFLICT DO NOTHING;
