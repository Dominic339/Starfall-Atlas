-- Phase 47: Live service admin systems
--
-- Adds four new subsystems for the in-game admin dev tool:
--   1. ship_classes   — ship model definitions with rarity tiers
--   2. balance_overrides — live-editable overrides for the static BALANCE config
--   3. live_events    — timed game events (special asteroids, boosts, resource nodes)
--   4. battle_passes  — seasonal battle passes with tiered quest/reward chains

-- ── 1. Ship classes ───────────────────────────────────────────────────────────
-- Defines the "model" or "class" for ships.  Individual player ships will
-- reference a class_id once the shipyard system is built; for now this table
-- drives the admin inventory of available ship models.

CREATE TABLE IF NOT EXISTS ship_classes (
  id                TEXT        PRIMARY KEY,         -- slug, e.g. "scout_mk1"
  name              TEXT        NOT NULL,             -- display name, e.g. "Scout Mk.I"
  description       TEXT        NOT NULL DEFAULT '',
  rarity            TEXT        NOT NULL DEFAULT 'common'
                                  CHECK (rarity IN ('common','uncommon','rare','legendary')),
  base_speed_ly_per_hr  NUMERIC(8,4) NOT NULL DEFAULT 10.0 CHECK (base_speed_ly_per_hr > 0),
  base_cargo_cap    INT         NOT NULL DEFAULT 100  CHECK (base_cargo_cap > 0),
  -- Max upgrade tiers allowed for this class (NULL = use global config)
  max_speed_tier    INT         CHECK (max_speed_tier IS NULL OR max_speed_tier >= 0),
  max_cargo_tier    INT         CHECK (max_cargo_tier IS NULL OR max_cargo_tier >= 0),
  -- Visual variant key used on the front-end (maps to SVG shape/skin set)
  icon_variant      TEXT        NOT NULL DEFAULT 'chevron'
                                  CHECK (icon_variant IN ('chevron','diamond','arrow','delta')),
  -- Credit cost to purchase/unlock this class at the shipyard (0 = free/starter)
  purchase_cost_credits INT     NOT NULL DEFAULT 0 CHECK (purchase_cost_credits >= 0),
  is_available      BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order        INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with the default ship class so existing ships have something to reference
INSERT INTO ship_classes (id, name, description, rarity, base_speed_ly_per_hr, base_cargo_cap, icon_variant, purchase_cost_credits, sort_order)
VALUES
  ('scout_mk1',     'Scout Mk.I',        'Fast, light scout vessel. Low cargo but excellent speed.', 'common',    12.0, 75,  'arrow',   0, 10),
  ('freighter_mk1', 'Freighter Mk.I',    'Balanced workhorse freighter. Solid all-around performance.', 'common', 10.0, 150, 'chevron', 0, 20),
  ('hauler_mk1',    'Heavy Hauler Mk.I', 'Slow but massive cargo capacity. Built for bulk runs.', 'common',        7.0, 300, 'delta',   500, 30),
  ('courier_mk2',   'Courier Mk.II',     'Upgraded courier with improved cargo and speed balance.', 'uncommon',   13.0, 120, 'arrow',   1500, 40),
  ('destroyer',     'Destroyer',         'Combat-grade hull with reinforced plating. Rare find.', 'rare',          15.0, 200, 'diamond', 5000, 50),
  ('titan',         'Titan',             'Legendary dreadnought-class freighter. Unmatched hauling power.', 'legendary', 8.0, 1000, 'delta', 25000, 60)
ON CONFLICT (id) DO NOTHING;

-- Add class reference to ships table (nullable to not break existing ships)
ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS class_id TEXT REFERENCES ship_classes(id) ON DELETE SET NULL;

-- ── 2. Balance overrides ──────────────────────────────────────────────────────
-- Key-value store for runtime overrides of the static BALANCE config.
-- Keys use dot-notation matching the TypeScript BALANCE object path,
-- e.g. "asteroids.baseHarvestUnitsPerHr" or "colony.taxPerHourByTier.2".
-- The game engine merges these over the static defaults at request time.

CREATE TABLE IF NOT EXISTS balance_overrides (
  key           TEXT        PRIMARY KEY,       -- dot-notation path
  value         JSONB       NOT NULL,           -- new value (type-matched to config)
  description   TEXT        NOT NULL DEFAULT '', -- why this override exists
  updated_by    UUID        REFERENCES players(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Live events ────────────────────────────────────────────────────────────
-- Timed game events created by admins. Each event has a type that determines
-- what the engine does with it (spawn asteroids, apply multipliers, etc.).

CREATE TABLE IF NOT EXISTS live_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  type          TEXT        NOT NULL CHECK (type IN (
    'special_asteroid',   -- spawns temporary asteroid nodes with special resources
    'harvest_boost',      -- multiplies asteroid harvest rate
    'credit_bonus',       -- grants bonus credits for specified activities
    'resource_node',      -- spawns gatherable resource deposits in systems
    'double_drop',        -- doubles resource yield from colonies/asteroids
    'currency_event'      -- premium-currency gated event with exclusive rewards
  )),
  -- JSONB config varies by type (see admin UI for schema per type)
  config        JSONB       NOT NULL DEFAULT '{}',
  -- Scheduling
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  is_active     BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Which systems does this event affect? NULL = all systems
  system_ids    TEXT[],
  -- For currency events: the premium cost to participate
  entry_cost_credits   INT CHECK (entry_cost_credits IS NULL OR entry_cost_credits >= 0),
  entry_cost_premium   INT CHECK (entry_cost_premium  IS NULL OR entry_cost_premium  >= 0),
  -- Tracking
  created_by    UUID        REFERENCES players(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_live_events_active
  ON live_events (is_active, starts_at, ends_at);

-- Asteroid nodes spawned specifically by live events
-- (supplement the existing asteroid_nodes table)
CREATE TABLE IF NOT EXISTS live_event_nodes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID        NOT NULL REFERENCES live_events(id) ON DELETE CASCADE,
  system_id       TEXT        NOT NULL,
  display_offset_x NUMERIC    NOT NULL DEFAULT 0,
  display_offset_y NUMERIC    NOT NULL DEFAULT 0,
  resource_type   TEXT        NOT NULL,
  total_amount    INT         NOT NULL CHECK (total_amount > 0),
  remaining_amount INT        NOT NULL CHECK (remaining_amount >= 0),
  status          TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','depleted','expired')),
  spawned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_live_event_nodes_event
  ON live_event_nodes (event_id);
CREATE INDEX IF NOT EXISTS idx_live_event_nodes_system
  ON live_event_nodes (system_id, status);

-- ── 4. Battle passes ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS battle_passes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,           -- e.g. "Season 1: First Contact"
  description     TEXT        NOT NULL DEFAULT '',
  season_number   INT         NOT NULL DEFAULT 1,
  max_tier        INT         NOT NULL DEFAULT 50 CHECK (max_tier > 0),
  -- How much XP per tier (flat for now; can be per-tier later)
  xp_per_tier     INT         NOT NULL DEFAULT 1000,
  -- Scheduling
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Premium pass cost in credits; NULL = free pass only
  premium_cost_credits INT    CHECK (premium_cost_credits IS NULL OR premium_cost_credits >= 0),
  premium_cost_premium INT    CHECK (premium_cost_premium  IS NULL OR premium_cost_premium  >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- One row per tier per battle pass; defines the quest and rewards for that tier
CREATE TABLE IF NOT EXISTS battle_pass_tiers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id         UUID        NOT NULL REFERENCES battle_passes(id) ON DELETE CASCADE,
  tier            INT         NOT NULL CHECK (tier >= 1),
  -- Quest/challenge description (plain text or markdown)
  quest_label     TEXT        NOT NULL DEFAULT '',  -- short label, e.g. "Gather 500 iron"
  quest_type      TEXT        NOT NULL DEFAULT 'manual'
                               CHECK (quest_type IN (
                                 'manual',            -- admin marks complete manually
                                 'gather_resource',   -- gather X units of a resource
                                 'travel_jumps',      -- complete X travel jumps
                                 'found_colonies',    -- found X colonies
                                 'harvest_asteroid',  -- harvest X units from asteroids
                                 'market_trades',     -- complete X market trades
                                 'alliance_activity'  -- alliance-related activity
                               )),
  quest_config    JSONB       NOT NULL DEFAULT '{}', -- e.g. {resource:"iron", amount:500}
  -- Free track reward
  free_reward_type   TEXT     NOT NULL DEFAULT 'credits'
                               CHECK (free_reward_type IN ('credits','resource','skin','ship_class','title')),
  free_reward_config JSONB    NOT NULL DEFAULT '{}',
  -- Premium track reward (only visible/claimable with premium pass)
  premium_reward_type   TEXT  CHECK (premium_reward_type IN ('credits','resource','skin','ship_class','title')),
  premium_reward_config JSONB NOT NULL DEFAULT '{}',
  UNIQUE (pass_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_bp_tiers_pass ON battle_pass_tiers (pass_id, tier);

-- Player progress on a battle pass
CREATE TABLE IF NOT EXISTS player_battle_pass (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pass_id         UUID        NOT NULL REFERENCES battle_passes(id) ON DELETE CASCADE,
  current_tier    INT         NOT NULL DEFAULT 0,   -- last unlocked tier
  xp_points       INT         NOT NULL DEFAULT 0,   -- XP toward next tier
  is_premium      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, pass_id)
);

CREATE INDEX IF NOT EXISTS idx_player_bp_player ON player_battle_pass (player_id);
