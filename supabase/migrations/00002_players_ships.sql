-- ============================================================
-- Migration 00002: Players and ships
-- Players are linked to Supabase Auth via auth_id.
-- Ships belong to players. Each player starts with one ship.
-- ============================================================

-- Players table: game profile linked to auth.users
CREATE TABLE players (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id               UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  handle                TEXT NOT NULL UNIQUE
                          CHECK (char_length(handle) BETWEEN 3 AND 32),
  credits               BIGINT NOT NULL DEFAULT 0
                          CHECK (credits >= 0),
  colony_slots          SMALLINT NOT NULL DEFAULT 1
                          CHECK (colony_slots >= 1),
  colony_permits_used   SMALLINT NOT NULL DEFAULT 0
                          CHECK (colony_permits_used >= 0 AND colony_permits_used <= 2),
  -- TRUE after the player places their first colony.
  -- Gates the pre-colony free-lane-travel rule.
  first_colony_placed   BOOLEAN NOT NULL DEFAULT FALSE,
  last_active_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Ships belong to a player. A ship is the primary actor for all travel/survey/claim actions.
CREATE TABLE ships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  speed_ly_per_hr   NUMERIC(8, 4) NOT NULL DEFAULT 1.0
                      CHECK (speed_ly_per_hr > 0),
  cargo_cap         INTEGER NOT NULL DEFAULT 100
                      CHECK (cargo_cap > 0),
  -- System and body where the ship is currently located.
  -- Both are NULL while the ship is in transit (travel_job pending).
  current_system_id TEXT,
  current_body_id   TEXT,
  -- Premium cosmetic reference (NULL = default skin)
  skin_entitlement_id UUID, -- FK to premium_entitlements added in migration 00010
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_ships_updated_at
  BEFORE UPDATE ON ships
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Ensure a ship can only be at a system+body combination (not body without system)
ALTER TABLE ships
  ADD CONSTRAINT chk_ship_location
    CHECK (
      (current_system_id IS NULL AND current_body_id IS NULL) OR
      (current_system_id IS NOT NULL)
    );
