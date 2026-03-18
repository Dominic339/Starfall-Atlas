-- ============================================================
-- Migration 00003: World state — discoveries and surveys
-- system_id / body_id are stable references into the star
-- catalog (deterministic world). They are NOT foreign keys to
-- any Supabase table — the catalog lives outside the DB.
-- ============================================================

-- Tracks which players have discovered which systems.
-- Multiple players may discover the same system.
-- is_first = TRUE only for the chronologically first discoverer.
CREATE TABLE system_discoveries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id     TEXT NOT NULL,
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  is_first      BOOLEAN NOT NULL DEFAULT FALSE,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (system_id, player_id)
);

-- Survey jobs: queued async action for a player surveying a body.
-- survey_complete_at is set by the server at submission time.
CREATE TABLE survey_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ship_id       UUID NOT NULL REFERENCES ships(id),
  system_id     TEXT NOT NULL,
  body_id       TEXT NOT NULL,
  -- is_deep = TRUE when the Deep Survey Kit premium item is consumed
  is_deep       BOOLEAN NOT NULL DEFAULT FALSE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  complete_at   TIMESTAMPTZ NOT NULL,
  status        job_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Revealed resource profiles for surveyed bodies.
-- Results are shared: once a body is surveyed by anyone, the
-- basic profile is visible to all players.
-- Deep nodes are only populated after a deep survey completes.
CREATE TABLE survey_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id         TEXT NOT NULL,
  body_id           TEXT NOT NULL UNIQUE,
  revealed_by       UUID NOT NULL REFERENCES players(id),
  -- JSON array: [{ "type": string, "quantity": integer, "is_rare": false }]
  resource_nodes    JSONB NOT NULL DEFAULT '[]'::jsonb,
  has_deep_nodes    BOOLEAN NOT NULL DEFAULT FALSE,
  -- JSON array: rare nodes revealed only by deep survey
  deep_nodes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_surveyed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_survey_results_updated_at
  BEFORE UPDATE ON survey_results
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
