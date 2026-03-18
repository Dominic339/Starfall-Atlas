-- ============================================================
-- Migration 00009: Alliances, members, goals, contributions
-- Also adds the deferred FK from hyperspace_lanes to alliances.
-- ============================================================

CREATE TABLE alliances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE
                    CHECK (char_length(name) BETWEEN 3 AND 64),
  founder_id      UUID NOT NULL REFERENCES players(id),
  member_count    SMALLINT NOT NULL DEFAULT 1
                    CHECK (member_count BETWEEN 1 AND 100),
  -- Premium cosmetic reference (NULL = default)
  emblem_entitlement_id UUID, -- FK to premium_entitlements added in 00010
  dissolved_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_alliances_updated_at
  BEFORE UPDATE ON alliances
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Alliance memberships.
-- UNIQUE (player_id) enforces the one-alliance-per-player rule.
CREATE TABLE alliance_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_id       UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  player_id         UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role              alliance_role NOT NULL DEFAULT 'member',
  -- Internal alliance currency; cannot be converted to Credits
  alliance_credits  BIGINT NOT NULL DEFAULT 0
                      CHECK (alliance_credits >= 0),
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One alliance per player at a time
  UNIQUE (player_id)
);

CREATE TRIGGER set_alliance_members_updated_at
  BEFORE UPDATE ON alliance_members
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Alliance goals posted by officers; members contribute resources.
CREATE TABLE alliance_goals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_id       UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  created_by        UUID NOT NULL REFERENCES players(id),
  title             TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 128),
  resource_type     TEXT NOT NULL,
  quantity_target   INTEGER NOT NULL CHECK (quantity_target > 0),
  quantity_filled   INTEGER NOT NULL DEFAULT 0
                      CHECK (quantity_filled >= 0),
  -- Alliance Credits disbursed to contributors on completion
  credit_reward     BIGINT NOT NULL DEFAULT 0
                      CHECK (credit_reward >= 0),
  deadline_at       TIMESTAMPTZ NOT NULL,
  completed_at      TIMESTAMPTZ,
  expired           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_alliance_goals_updated_at
  BEFORE UPDATE ON alliance_goals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Individual member contributions toward a goal (immutable log)
CREATE TABLE alliance_goal_contributions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id         UUID NOT NULL REFERENCES alliance_goals(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES players(id),
  resource_type   TEXT NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  contributed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Now that alliances exists, add the FK from hyperspace_lanes
ALTER TABLE hyperspace_lanes
  ADD CONSTRAINT fk_lane_alliance
    FOREIGN KEY (alliance_id) REFERENCES alliances(id) ON DELETE SET NULL;
