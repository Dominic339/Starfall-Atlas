-- ============================================================
-- Migration 00005: Hyperspace lanes and construction jobs
-- alliance_id FK to alliances is added in migration 00009.
-- UNIQUE (from_system_id, to_system_id) prevents duplicate lanes.
-- ============================================================

CREATE TABLE hyperspace_lanes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES players(id),
  from_system_id    TEXT NOT NULL,
  to_system_id      TEXT NOT NULL,
  access_level      lane_access NOT NULL DEFAULT 'public',
  -- Transit tax as integer percentage, 0–5 (capped by BALANCE config)
  transit_tax_rate  SMALLINT NOT NULL DEFAULT 0
                      CHECK (transit_tax_rate BETWEEN 0 AND 5),
  -- FALSE until lane_construction_job completes
  is_active         BOOLEAN NOT NULL DEFAULT FALSE,
  built_at          TIMESTAMPTZ,
  -- Set when access_level = 'alliance_only'.
  -- FK to alliances(id) added in 00009_alliances.sql
  alliance_id       UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Only one lane per directed system pair
  UNIQUE (from_system_id, to_system_id)
);

CREATE TRIGGER set_hyperspace_lanes_updated_at
  BEFORE UPDATE ON hyperspace_lanes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Enforce: alliance_id must be set when access_level is 'alliance_only'
ALTER TABLE hyperspace_lanes
  ADD CONSTRAINT chk_alliance_lane
    CHECK (
      access_level != 'alliance_only' OR alliance_id IS NOT NULL
    );

-- Lane construction jobs
CREATE TABLE lane_construction_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_id     UUID NOT NULL REFERENCES hyperspace_lanes(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES players(id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  complete_at TIMESTAMPTZ NOT NULL,
  status      job_status NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
