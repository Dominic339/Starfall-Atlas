-- ============================================================
-- Migration 00042: Multiplayer Visibility — Phase 1
--
-- Adds two tables that enable the shared-world multiplayer layer:
--
--   body_stewardship
--     The first player to found a colony on a planetary body
--     becomes its steward. Stewards can grant colony permits to
--     other players for that body. One steward per body at a time.
--     (Body IDs are globally unique: "{system_id}:{body_index}".)
--
--   colony_permits
--     Stewards may grant named players the right to found/maintain
--     a colony on their body. Includes optional tax configuration.
--     The steward's own colony does not require a permit.
--
-- RLS policy summary:
--   body_stewardship  — public read (world state); steward writes
--   colony_permits    — readable by steward_id OR grantee_id;
--                       insertable by steward via service role
-- ============================================================

-- ------------------------------------------------------------
-- 1. body_stewardship
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS body_stewardship (
  body_id        TEXT        PRIMARY KEY,
  steward_id     UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  system_id      TEXT        NOT NULL,
  claimed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_body_stewardship_steward
  ON body_stewardship (steward_id);

CREATE INDEX IF NOT EXISTS idx_body_stewardship_system
  ON body_stewardship (system_id);

-- ------------------------------------------------------------
-- 2. colony_permits
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS colony_permits (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  body_id        TEXT        NOT NULL REFERENCES body_stewardship(body_id) ON DELETE CASCADE,
  steward_id     UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  grantee_id     UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- Tax configuration: what portion of the grantee's colony output the steward collects.
  -- Phase 1: stored but not yet enforced mechanically (will be wired in Phase 2).
  tax_type       TEXT        NOT NULL DEFAULT 'percentage'
                               CHECK (tax_type IN ('percentage', 'flat_iron')),
  tax_rate_pct   SMALLINT    NOT NULL DEFAULT 10
                               CHECK (tax_rate_pct BETWEEN 0 AND 50),
  status         TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'revoked')),
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  -- One active permit per (body, grantee). Stewards can revoke and re-grant.
  UNIQUE (body_id, grantee_id)
);

CREATE INDEX IF NOT EXISTS idx_colony_permits_body
  ON colony_permits (body_id);

CREATE INDEX IF NOT EXISTS idx_colony_permits_steward
  ON colony_permits (steward_id);

CREATE INDEX IF NOT EXISTS idx_colony_permits_grantee
  ON colony_permits (grantee_id);

-- ------------------------------------------------------------
-- 3. RLS — body_stewardship
-- ------------------------------------------------------------

ALTER TABLE body_stewardship ENABLE ROW LEVEL SECURITY;

-- Anyone (authenticated or anon) may read stewardship data — it's world state.
CREATE POLICY "body_stewardship_public_read"
  ON body_stewardship
  FOR SELECT
  USING (true);

-- Service role (API routes via admin client) handles all writes — no player-direct writes.
-- (No INSERT/UPDATE/DELETE policies needed; admin client bypasses RLS.)

-- ------------------------------------------------------------
-- 4. RLS — colony_permits
-- ------------------------------------------------------------

ALTER TABLE colony_permits ENABLE ROW LEVEL SECURITY;

-- Stewards can see permits they've issued; grantees can see permits they've received.
CREATE POLICY "colony_permits_read_by_involved"
  ON colony_permits
  FOR SELECT
  USING (
    steward_id = (SELECT id FROM players WHERE auth_id = auth.uid() LIMIT 1)
    OR
    grantee_id = (SELECT id FROM players WHERE auth_id = auth.uid() LIMIT 1)
  );

-- All writes go through admin client (service role bypasses RLS).
