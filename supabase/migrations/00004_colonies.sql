-- ============================================================
-- Migration 00004: Colonies, structures, construction jobs
-- UNIQUE (body_id) on colonies enforces one colony per body.
-- Claim contention is resolved via SELECT FOR UPDATE in app code.
-- ============================================================

-- System ownership: grants lane-building and royalty rights.
-- Set when a player claims a system's anchor point or establishes
-- a colony on the primary habitable body.
CREATE TABLE system_ownership (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id     TEXT NOT NULL UNIQUE,
  owner_id      UUID NOT NULL REFERENCES players(id),
  -- Royalty % charged to non-owner extractors in this system (0–20)
  royalty_rate  SMALLINT NOT NULL DEFAULT 0
                  CHECK (royalty_rate BETWEEN 0 AND 20),
  acquired_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_system_ownership_updated_at
  BEFORE UPDATE ON system_ownership
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Colonies: a player's claimed settlement on a body.
-- body_id UNIQUE constraint prevents simultaneous claims.
CREATE TABLE colonies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID NOT NULL REFERENCES players(id),
  system_id             TEXT NOT NULL,
  body_id               TEXT NOT NULL UNIQUE,
  population_tier       SMALLINT NOT NULL DEFAULT 1
                          CHECK (population_tier BETWEEN 1 AND 10),
  -- NULL until growth conditions are met
  next_growth_at        TIMESTAMPTZ,
  -- Used for lazy tax calculation (see GAME_RULES.md §7)
  last_tax_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  storage_cap           INTEGER NOT NULL DEFAULT 1000
                          CHECK (storage_cap > 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_colonies_updated_at
  BEFORE UPDATE ON colonies
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Structures built on colony bodies.
-- is_active = FALSE until the construction job completes.
CREATE TABLE structures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colony_id             UUID NOT NULL REFERENCES colonies(id) ON DELETE CASCADE,
  owner_id              UUID NOT NULL REFERENCES players(id),
  type                  structure_type NOT NULL,
  tier                  SMALLINT NOT NULL DEFAULT 1
                          CHECK (tier BETWEEN 1 AND 5),
  is_active             BOOLEAN NOT NULL DEFAULT FALSE,
  built_at              TIMESTAMPTZ,
  -- Extractor-specific fields (NULL for non-extractor types)
  last_extract_at       TIMESTAMPTZ,
  extract_resource_type TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_structures_updated_at
  BEFORE UPDATE ON structures
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Enforce: extract_resource_type must be set for extractors
ALTER TABLE structures
  ADD CONSTRAINT chk_extractor_resource
    CHECK (
      type != 'extractor' OR extract_resource_type IS NOT NULL
    );

-- Construction jobs: async job for building / upgrading a structure.
CREATE TABLE construction_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id  UUID NOT NULL REFERENCES structures(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  complete_at   TIMESTAMPTZ NOT NULL,
  status        job_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
