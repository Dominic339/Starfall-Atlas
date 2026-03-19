-- ============================================================
-- Migration 00014: Ownership model v2
--
-- Implements the governance model from GAME_RULES.md §4 and
-- SCHEMA_NOTES.md §6–7:
--
--   1. New enums: colony_status, gate_status
--   2. Add colony lifecycle columns (status, abandoned_at, collapsed_at)
--   3. Add world_event_type values for stewardship and collapse events
--   4. Rename system_ownership → system_stewardship with new columns
--   5. New table: system_majority_control
--   6. New table: system_influence_cache
--   7. New table: hyperspace_gates
--   8. New table: gate_construction_jobs
--   9. Add gate FK columns to hyperspace_lanes
--  10. New table: universal_exchange_purchases
--  11. Update auction item_type constraint to include 'stewardship'
--  12. Update indexes for new tables and columns
-- ============================================================

-- ============================================================
-- 1. New enums
-- ============================================================

CREATE TYPE colony_status AS ENUM (
  'active',
  'abandoned',
  'collapsed'
);

CREATE TYPE gate_status AS ENUM (
  'inactive',
  'active',
  'neutral'
);

-- ============================================================
-- 2. Colony lifecycle columns
-- ============================================================

ALTER TABLE colonies
  ADD COLUMN status      colony_status NOT NULL DEFAULT 'active',
  ADD COLUMN abandoned_at TIMESTAMPTZ,
  ADD COLUMN collapsed_at TIMESTAMPTZ;

-- Enforce consistency: abandoned_at required when status = 'abandoned'
ALTER TABLE colonies
  ADD CONSTRAINT chk_colony_abandoned_at
    CHECK (status != 'abandoned' OR abandoned_at IS NOT NULL);

-- Enforce consistency: collapsed_at required when status = 'collapsed'
ALTER TABLE colonies
  ADD CONSTRAINT chk_colony_collapsed_at
    CHECK (status != 'collapsed' OR collapsed_at IS NOT NULL);

-- ============================================================
-- 3. Extend world_event_type with new event values
--
-- Postgres does not support ALTER TYPE ADD VALUE inside a
-- transaction with other DDL in all versions, so we use
-- individual statements. They are idempotent in Postgres 14+.
-- ============================================================

ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'stewardship_registered';
ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'stewardship_transferred';
ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'majority_control_gained';
ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'majority_control_lost';
ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'colony_abandoned';
ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'colony_collapsed';
ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'colony_reactivated';
ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'system_sold';
ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'gate_built';
ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'gate_neutralized';
ALTER TYPE world_event_type ADD VALUE IF NOT EXISTS 'gate_reclaimed';

-- ============================================================
-- 4. Rename system_ownership → system_stewardship
--    and add governance columns
-- ============================================================

ALTER TABLE system_ownership RENAME TO system_stewardship;
ALTER TABLE system_stewardship RENAME COLUMN owner_id TO steward_id;

-- Add stewardship metadata columns
ALTER TABLE system_stewardship
  ADD COLUMN method TEXT NOT NULL DEFAULT 'discovery'
    CHECK (method IN ('discovery', 'transfer', 'auction')),
  ADD COLUMN has_governance BOOLEAN NOT NULL DEFAULT TRUE;

-- Rename the trigger to match new table name
DROP TRIGGER IF EXISTS set_system_ownership_updated_at ON system_stewardship;
CREATE TRIGGER set_system_stewardship_updated_at
  BEFORE UPDATE ON system_stewardship
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- 5. New table: system_majority_control
-- ============================================================

CREATE TABLE system_majority_control (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id        TEXT NOT NULL UNIQUE,
  controller_id    UUID NOT NULL REFERENCES players(id),
  -- Non-NULL when majority is held collectively by an alliance
  alliance_id      UUID REFERENCES alliances(id) ON DELETE SET NULL,
  -- Influence share (0.5–1.0) at time control was last confirmed
  influence_share  NUMERIC(5, 4) NOT NULL
                     CHECK (influence_share > 0.5 AND influence_share <= 1.0),
  -- FALSE when controller has fallen below threshold (contested)
  is_confirmed     BOOLEAN NOT NULL DEFAULT TRUE,
  control_since    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_system_majority_control_updated_at
  BEFORE UPDATE ON system_majority_control
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- 6. New table: system_influence_cache
-- ============================================================

CREATE TABLE system_influence_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id    TEXT NOT NULL,
  player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  influence    INTEGER NOT NULL DEFAULT 0 CHECK (influence >= 0),
  colony_count SMALLINT NOT NULL DEFAULT 0,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (system_id, player_id)
);

-- ============================================================
-- 7. New table: hyperspace_gates
-- ============================================================

CREATE TABLE hyperspace_gates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id      TEXT NOT NULL UNIQUE,    -- one gate per system
  owner_id       UUID NOT NULL REFERENCES players(id),
  status         gate_status NOT NULL DEFAULT 'inactive',
  tier           SMALLINT NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 5),
  built_at       TIMESTAMPTZ,             -- set when status → 'active'
  neutralized_at TIMESTAMPTZ,             -- set when governance changes
  reclaimed_at   TIMESTAMPTZ,             -- set when neutral gate is reactivated
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_hyperspace_gates_updated_at
  BEFORE UPDATE ON hyperspace_gates
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- 8. New table: gate_construction_jobs
-- ============================================================

CREATE TABLE gate_construction_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id     UUID NOT NULL REFERENCES hyperspace_gates(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES players(id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  complete_at TIMESTAMPTZ NOT NULL,
  status      job_status NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 9. Add gate FK columns to hyperspace_lanes
-- ============================================================

ALTER TABLE hyperspace_lanes
  ADD COLUMN from_gate_id UUID REFERENCES hyperspace_gates(id) ON DELETE SET NULL,
  ADD COLUMN to_gate_id   UUID REFERENCES hyperspace_gates(id) ON DELETE SET NULL;

-- ============================================================
-- 10. New table: universal_exchange_purchases
-- ============================================================

CREATE TABLE universal_exchange_purchases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('iron', 'carbon', 'ice')),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  credits_paid  BIGINT NOT NULL CHECK (credits_paid > 0),
  colony_id     UUID NOT NULL REFERENCES colonies(id),
  purchased_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 11. Update auctions.item_type constraint
--     ('system' → 'stewardship'; add 'stewardship' value)
-- ============================================================

-- Drop the existing CHECK constraint on item_type
ALTER TABLE auctions DROP CONSTRAINT IF EXISTS auctions_item_type_check;

-- Re-add with updated allowed values (keep 'system' for backwards-compat
-- with any existing rows; new code should use 'stewardship')
ALTER TABLE auctions
  ADD CONSTRAINT auctions_item_type_check
    CHECK (item_type IN ('colony', 'stewardship', 'system', 'ship', 'item'));

-- ============================================================
-- 12. New indexes
-- ============================================================

-- Colony status (for finding abandoned/collapsed colonies efficiently)
CREATE INDEX idx_colonies_status ON colonies (status)
  WHERE status IN ('abandoned', 'collapsed');

CREATE INDEX idx_colonies_owner_status ON colonies (owner_id, status);

-- Inactivity check: finding players who haven't logged in recently
CREATE INDEX idx_players_last_active ON players (last_active_at);

-- System governance
CREATE INDEX idx_stewardship_system  ON system_stewardship (system_id);
CREATE INDEX idx_stewardship_steward ON system_stewardship (steward_id);

CREATE INDEX idx_majority_control_system      ON system_majority_control (system_id);
CREATE INDEX idx_majority_control_controller  ON system_majority_control (controller_id)
  WHERE is_confirmed = TRUE;

CREATE INDEX idx_influence_system  ON system_influence_cache (system_id);
CREATE INDEX idx_influence_player  ON system_influence_cache (player_id);

-- Gates
CREATE INDEX idx_gates_system ON hyperspace_gates (system_id);
CREATE INDEX idx_gates_owner  ON hyperspace_gates (owner_id);
CREATE INDEX idx_gates_status ON hyperspace_gates (status)
  WHERE status = 'neutral';

CREATE INDEX idx_gate_constr_gate   ON gate_construction_jobs (gate_id);
CREATE INDEX idx_gate_constr_status ON gate_construction_jobs (status)
  WHERE status = 'pending';

-- Lanes with gate refs
CREATE INDEX idx_lanes_from_gate ON hyperspace_lanes (from_gate_id)
  WHERE from_gate_id IS NOT NULL;
CREATE INDEX idx_lanes_to_gate ON hyperspace_lanes (to_gate_id)
  WHERE to_gate_id IS NOT NULL;

-- EUX purchase log: daily limit check
CREATE INDEX idx_eux_player_date ON universal_exchange_purchases (player_id, purchased_at);

-- ============================================================
-- 13. RLS for new tables
-- ============================================================

ALTER TABLE system_stewardship            ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_majority_control       ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_influence_cache        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyperspace_gates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_construction_jobs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE universal_exchange_purchases  ENABLE ROW LEVEL SECURITY;

-- System governance tables: all authenticated users can read (public world state)
CREATE POLICY "authenticated_read_stewardship"
  ON system_stewardship FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "authenticated_read_majority_control"
  ON system_majority_control FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "authenticated_read_influence_cache"
  ON system_influence_cache FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "authenticated_read_gates"
  ON hyperspace_gates FOR SELECT TO authenticated USING (TRUE);

-- Gate construction jobs: owner only
CREATE POLICY "own_gate_construction_jobs"
  ON gate_construction_jobs FOR SELECT TO authenticated
  USING (player_id = auth_player_id());

-- EUX purchases: own records only
CREATE POLICY "own_eux_purchases"
  ON universal_exchange_purchases FOR SELECT TO authenticated
  USING (player_id = auth_player_id());

-- Colony status is now public (abandonment/collapse visible to all)
-- The existing policy "authenticated_read_colonies" already covers this.
