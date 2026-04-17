-- ==============================================================
-- Combined missing migrations: 00020 -> 00042
-- Safe to re-run: uses IF NOT EXISTS + DROP POLICY IF EXISTS.
-- Paste the entire file into the Supabase SQL editor and run.
-- ==============================================================

-- ---- 00020_phase10.sql ----
-- Phase 10: Research System Foundation
--
-- Stores per-player research unlocks. Research definitions live entirely
-- in src/lib/config/research.ts (code) — only unlocked state is persisted.
--
-- research_id TEXT references a key from RESEARCH_DEFS in research.ts.
-- UNIQUE (player_id, research_id) prevents double-unlocking.

CREATE TABLE IF NOT EXISTS player_research (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  research_id  TEXT NOT NULL,
  unlocked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_research_unique UNIQUE (player_id, research_id)
);

-- Fast lookup of a player's full research set (used on dashboard + purchase).
CREATE INDEX IF NOT EXISTS idx_player_research_player
  ON player_research (player_id);

-- RLS: players may only read their own research rows.
-- Write access is handled by the admin client only (server-side routes).
ALTER TABLE player_research ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "player_research_select_own" ON player_research;
CREATE POLICY "player_research_select_own"
  ON player_research FOR SELECT
  USING (player_id = auth.uid()::uuid);


-- ---- 00021_phase11.sql ----
-- Phase 11: Ship Upgrades and Tier Enforcement
--
-- Adds 6 per-stat upgrade level columns to the ships table.
-- All levels start at 0. Research controls the cap on each level (via
-- researchHelpers.maxStatLevel) and on the sum of all levels per ship
-- (via researchHelpers.maxTotalShipUpgrades).
--
-- Wired effects (derived stat updated on upgrade):
--   cargo_level  → cargo_cap  = 100 + cargo_level  × 50
--   engine_level → speed_ly_per_hr = 1.0 + engine_level × 0.2
--
-- Scaffold (tracked but no active gameplay effect yet):
--   hull_level, shield_level, turret_level, utility_level
--
-- DB-level CHECK constraints cap each column at the absolute maximum (10).
-- Research-based soft caps are enforced in the upgrade route.

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS hull_level    INTEGER NOT NULL DEFAULT 0
    CHECK (hull_level    >= 0 AND hull_level    <= 10),
  ADD COLUMN IF NOT EXISTS shield_level  INTEGER NOT NULL DEFAULT 0
    CHECK (shield_level  >= 0 AND shield_level  <= 10),
  ADD COLUMN IF NOT EXISTS cargo_level   INTEGER NOT NULL DEFAULT 0
    CHECK (cargo_level   >= 0 AND cargo_level   <= 10),
  ADD COLUMN IF NOT EXISTS engine_level  INTEGER NOT NULL DEFAULT 0
    CHECK (engine_level  >= 0 AND engine_level  <= 10),
  ADD COLUMN IF NOT EXISTS turret_level  INTEGER NOT NULL DEFAULT 0
    CHECK (turret_level  >= 0 AND turret_level  <= 10),
  ADD COLUMN IF NOT EXISTS utility_level INTEGER NOT NULL DEFAULT 0
    CHECK (utility_level >= 0 AND utility_level <= 10);


-- ---- 00022_phase12.sql ----
-- Phase 12: Fleet Foundation and Manual Fleet Dispatch
--
-- Adds:
--   fleets        — fleet header (player-owned grouping of co-located ships)
--   fleet_ships   — join table linking ships to their fleet (UNIQUE ship_id enforces one fleet per ship)
--   travel_jobs.fleet_id — nullable FK linking a travel job to the fleet that dispatched it

-- ── Fleets ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleets (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  -- 'active'    = ships are co-located at current_system_id (staged or post-arrival)
  -- 'traveling' = ships have pending travel jobs en route to a destination
  -- 'disbanded' = fleet dissolved; fleet_ships rows deleted; ships freed
  status           TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'traveling', 'disbanded')),
  -- Current system when status='active'. NULL while traveling.
  current_system_id TEXT,
  disbanded_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Fleet Ships (join table) ──────────────────────────────────────────────────
-- UNIQUE (ship_id) ensures a ship belongs to at most one fleet at a time.
CREATE TABLE IF NOT EXISTS fleet_ships (
  fleet_id  UUID        NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
  ship_id   UUID        NOT NULL REFERENCES ships(id)  ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (fleet_id, ship_id),
  UNIQUE (ship_id)
);

-- ── Extend travel_jobs ────────────────────────────────────────────────────────
ALTER TABLE travel_jobs
  ADD COLUMN IF NOT EXISTS fleet_id UUID REFERENCES fleets(id);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fleets_player_active
  ON fleets (player_id)
  WHERE status != 'disbanded';

CREATE INDEX IF NOT EXISTS idx_fleet_ships_fleet
  ON fleet_ships (fleet_id);

CREATE INDEX IF NOT EXISTS idx_travel_jobs_fleet
  ON travel_jobs (fleet_id)
  WHERE fleet_id IS NOT NULL;

-- ── Row-level security ────────────────────────────────────────────────────────
ALTER TABLE fleets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_ships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleets_select_own" ON fleets;
CREATE POLICY "fleets_select_own" ON fleets
  FOR SELECT USING (player_id = auth.uid()::uuid);

DROP POLICY IF EXISTS "fleet_ships_select_own" ON fleet_ships;
CREATE POLICY "fleet_ships_select_own" ON fleet_ships
  FOR SELECT USING (
    fleet_id IN (SELECT id FROM fleets WHERE player_id = auth.uid()::uuid)
  );


-- ---- 00023_phase13.sql ----
-- Phase 13: Fleet Slot Model and Auto Fleet Logic
--
-- Adds:
--   player_fleet_slots — persistent fleet slot configuration (mode + current fleet assignment)
--
-- player_fleet_slots columns:
--   slot_number         — 1-based index (Fleet 1, Fleet 2, …)
--   name                — display name, e.g. "Fleet 1"
--   mode                — manual | auto_collect_nearest | auto_collect_highest
--   current_fleet_id    — active fleet assigned to this slot (nullable)
--   auto_state          — lazy auto loop state for the slot
--   auto_target_colony_id — colony being targeted in the current auto cycle

CREATE TABLE IF NOT EXISTS player_fleet_slots (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot_number           INTEGER     NOT NULL,
  name                  TEXT        NOT NULL,
  mode                  TEXT        NOT NULL DEFAULT 'manual'
                                    CHECK (mode IN ('manual', 'auto_collect_nearest', 'auto_collect_highest')),
  current_fleet_id      UUID        REFERENCES fleets(id),
  auto_state            TEXT        CHECK (auto_state IN ('idle', 'going_to_colony', 'going_to_station')),
  auto_target_colony_id UUID        REFERENCES colonies(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_fleet_slots_unique UNIQUE (player_id, slot_number)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fleet_slots_player
  ON player_fleet_slots (player_id);

-- ── Row-level security ────────────────────────────────────────────────────────
ALTER TABLE player_fleet_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_slots_select_own" ON player_fleet_slots;
CREATE POLICY "fleet_slots_select_own" ON player_fleet_slots
  FOR SELECT USING (player_id = auth.uid()::uuid);


-- ---- 00024_phase14.sql ----
-- Phase 14: Colony Structures and Colony Tech Wiring
--
-- Changes:
--   1. Add 'habitat_module' to the structure_type enum
--   2. Drop the extractor-only resource constraint (no longer needed in Phase 14
--      where extractors give a yield bonus without a fixed resource type)
--   3. Add UNIQUE (colony_id, type): one structure of each type per colony

-- ── 1. Extend the enum ────────────────────────────────────────────────────────
ALTER TYPE structure_type ADD VALUE IF NOT EXISTS 'habitat_module';

-- ── 2. Drop old extractor constraint ─────────────────────────────────────────
ALTER TABLE structures DROP CONSTRAINT IF EXISTS chk_extractor_resource;

-- ── 3. One structure per type per colony ─────────────────────────────────────
ALTER TABLE structures
  ADD CONSTRAINT structures_colony_type_unique UNIQUE (colony_id, type);


-- ---- 00025_phase15.sql ----
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


-- ---- 00026_phase20.sql ----
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


-- ---- 00027_phase23.sql ----
-- Phase 23: Alliance Tag, Invite Codes, and Alliance Beacons
--
-- Extends the existing alliances table (created in 00009) with:
--   1. tag         — short display tag (2–5 chars) shown on map beacons
--   2. invite_code — short random token for the alpha direct-join flow
--
-- Adds:
--   3. alliance_beacons — placeable infrastructure markers on catalog systems
--
-- Design notes:
--   - tag is unique (case-insensitive) and shown beside beacon markers on the galaxy map.
--   - invite_code is a random 8-char hex prefix; alliance founders share it to recruit.
--   - Beacon uniqueness is enforced by a partial unique index (one active beacon per
--     alliance per system).
--   - Beacon removal is a soft-delete: is_active = false, removed_at = NOW().
--   - system_id references the alpha catalog (text key, not a FK).
--   - No RLS needed on alliance_beacons (world-readable, officer/founder-written via API).

-- ── 1. Add tag column to alliances ───────────────────────────────────────────

ALTER TABLE alliances
  ADD COLUMN IF NOT EXISTS tag TEXT
    CHECK (char_length(tag) BETWEEN 2 AND 5);

-- Backfill any existing rows with an uppercase prefix of the name
UPDATE alliances
  SET tag = UPPER(LEFT(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'), 4))
  WHERE tag IS NULL;

-- Enforce NOT NULL after backfill
ALTER TABLE alliances
  ALTER COLUMN tag SET NOT NULL;

-- Case-insensitive unique index (allows 'SOL' and 'sol' to be treated as the same)
CREATE UNIQUE INDEX IF NOT EXISTS idx_alliances_tag
  ON alliances(lower(tag));

-- ── 2. Add invite_code column to alliances ────────────────────────────────────

ALTER TABLE alliances
  ADD COLUMN IF NOT EXISTS invite_code TEXT
    UNIQUE;

-- Backfill any existing rows
UPDATE alliances
  SET invite_code = LOWER(LEFT(gen_random_uuid()::TEXT, 8))
  WHERE invite_code IS NULL;

-- Enforce NOT NULL and set default for future inserts
ALTER TABLE alliances
  ALTER COLUMN invite_code SET NOT NULL;

ALTER TABLE alliances
  ALTER COLUMN invite_code SET DEFAULT LOWER(LEFT(gen_random_uuid()::TEXT, 8));

-- ── 3. alliance_beacons ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alliance_beacons (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  alliance_id   UUID        NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,

  -- Alpha-catalog system identifier (text key; not a FK — catalog lives in code)
  system_id     TEXT        NOT NULL,

  -- Player who placed this beacon (must have been officer or founder at placement time)
  placed_by     UUID        NOT NULL REFERENCES players(id),

  -- Soft-disable: true = visible/active on the map; false = removed
  is_active     BOOLEAN     NOT NULL DEFAULT true,

  placed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at    TIMESTAMPTZ           -- NULL while active
);

CREATE INDEX IF NOT EXISTS idx_alliance_beacons_alliance
  ON alliance_beacons(alliance_id);

CREATE INDEX IF NOT EXISTS idx_alliance_beacons_system
  ON alliance_beacons(system_id);

-- Prevent duplicate active beacons for the same alliance in the same system
CREATE UNIQUE INDEX IF NOT EXISTS idx_alliance_beacons_active
  ON alliance_beacons(alliance_id, system_id)
  WHERE is_active = true;


-- ---- 00028_disputes.sql ----
-- Phase 25: Beacon Disputes Foundation
--
-- Adds the dispute system for challenging alliance beacons.
--
-- Rules (alpha):
--   - Only active beacons NOT inside a completed territory loop are disputable.
--   - 8-hour dispute window.
--   - Reinforcement-based (fleet commitment) + time-based resolution.
--   - Highest total score at deadline wins.
--   - No ship loss; fleets are committed/unavailable during dispute.
--   - After resolution: 48-hour cooldown on disputed beacon + nearby linked beacons.
--
-- Tables added:
--   1. disputes               — one row per active or resolved dispute
--   2. dispute_reinforcements — fleet commitments for a dispute
--   3. beacon_cooldowns       — post-resolution cooldown records
--
-- Column added to fleets:
--   4. dispute_commit_id — non-null when fleet is locked in a dispute

-- ── 1. disputes ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS disputes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The beacon being challenged
  beacon_id             UUID        NOT NULL REFERENCES alliance_beacons(id) ON DELETE CASCADE,

  -- The alliance that owns the beacon (defender)
  defending_alliance_id UUID        NOT NULL REFERENCES alliances(id),

  -- The alliance that opened the challenge (attacker)
  attacking_alliance_id UUID        NOT NULL REFERENCES alliances(id),

  -- 'open'     = dispute window is active
  -- 'resolved' = winner determined and outcome applied
  -- 'expired'  = dispute window closed with no valid reinforcements on either side
  status                TEXT        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'resolved', 'expired')),

  opened_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolves_at           TIMESTAMPTZ NOT NULL,

  -- Set when status transitions out of 'open'
  resolved_at           TIMESTAMPTZ,

  -- NULL until resolved. When resolved: the winning alliance id.
  winner_alliance_id    UUID        REFERENCES alliances(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disputes_beacon
  ON disputes(beacon_id);

CREATE INDEX IF NOT EXISTS idx_disputes_defending
  ON disputes(defending_alliance_id);

CREATE INDEX IF NOT EXISTS idx_disputes_attacking
  ON disputes(attacking_alliance_id);

CREATE INDEX IF NOT EXISTS idx_disputes_status
  ON disputes(status);

-- Only one active dispute per beacon at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_disputes_beacon_open
  ON disputes(beacon_id)
  WHERE status = 'open';

-- ── 2. dispute_reinforcements ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dispute_reinforcements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  dispute_id      UUID        NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,

  -- The alliance this fleet is fighting for (must be defending or attacking)
  alliance_id     UUID        NOT NULL REFERENCES alliances(id),

  fleet_id        UUID        NOT NULL REFERENCES fleets(id),
  player_id       UUID        NOT NULL REFERENCES players(id),

  -- Frozen at commit time for deterministic resolution
  score_snapshot  INTEGER     NOT NULL DEFAULT 0,

  committed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Set to false on dispute resolution (fleet unlocked)
  is_active       BOOLEAN     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_dispute_reinforcements_dispute
  ON dispute_reinforcements(dispute_id);

CREATE INDEX IF NOT EXISTS idx_dispute_reinforcements_fleet
  ON dispute_reinforcements(fleet_id);

-- One active commitment per fleet (a fleet can only fight in one dispute at a time)
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispute_reinforcements_fleet_active
  ON dispute_reinforcements(fleet_id)
  WHERE is_active = true;

-- ── 3. beacon_cooldowns ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS beacon_cooldowns (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The beacon that is on cooldown
  beacon_id   UUID        NOT NULL REFERENCES alliance_beacons(id) ON DELETE CASCADE,

  -- The dispute that caused this cooldown
  dispute_id  UUID        NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,

  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beacon_cooldowns_beacon
  ON beacon_cooldowns(beacon_id);

-- Composite index for cooldown lookups by beacon + expiry
-- (partial unique with NOW() not allowed — NOW() is STABLE, not IMMUTABLE)
CREATE INDEX IF NOT EXISTS idx_beacon_cooldowns_beacon_active
  ON beacon_cooldowns(beacon_id, expires_at);

-- ── 4. Lock column on fleets ─────────────────────────────────────────────────

ALTER TABLE fleets
  ADD COLUMN IF NOT EXISTS dispute_commit_id UUID
    REFERENCES disputes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fleets_dispute_commit
  ON fleets(dispute_commit_id)
  WHERE dispute_commit_id IS NOT NULL;


-- ---- 00029_phase26_profiles.sql ----
-- ============================================================
-- Migration 00029: Phase 26 — Profile System & Account Lifecycle
-- ============================================================

-- ── Profile fields on players ────────────────────────────────
-- Extend the players table with optional cosmetic / bio fields.
-- All new columns are nullable so existing rows are unaffected.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS title         TEXT         CHECK (char_length(title)  <= 64),
  ADD COLUMN IF NOT EXISTS bio           TEXT         CHECK (char_length(bio)    <= 512),
  ADD COLUMN IF NOT EXISTS banner_id     TEXT         CHECK (char_length(banner_id) <= 64),
  ADD COLUMN IF NOT EXISTS logo_id       TEXT         CHECK (char_length(logo_id)   <= 64),
  -- Soft-delete: set when the player requests account deletion.
  -- Game-layout middleware redirects deactivated players to /deactivated.
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ DEFAULT NULL;

-- ── Handle character-set enforcement ────────────────────────
-- Enforce alphanumeric + underscore only (no spaces, no symbols).
-- The check on char_length already exists from migration 00002.
ALTER TABLE players
  ADD CONSTRAINT chk_handle_chars
    CHECK (handle ~ '^[A-Za-z0-9_]+$');

-- ── Index for public profile look-ups by handle ──────────────
CREATE INDEX IF NOT EXISTS idx_players_handle_lower
  ON players (lower(handle));

-- ── Index for active (non-deactivated) player look-ups ───────
CREATE INDEX IF NOT EXISTS idx_players_active
  ON players (id)
  WHERE deactivated_at IS NULL;


-- ---- 00030_phase28_repair.sql ----
-- ============================================================
-- Migration 00030: Phase 28 — Schema repair & data cleanup
--
-- PURPOSE: Idempotent catch-up migration for Supabase instances
-- where some earlier migrations (00014–00019) were not applied.
--
-- All DDL statements use IF NOT EXISTS / DO$$...EXCEPTION guards
-- so this migration is safe to re-run even when columns/tables
-- already exist.
--
-- CONFIRMED MISSING (from runtime error):
--   colonies.last_extract_at  (00017)
--
-- POSSIBLY MISSING (added defensively):
--   colonies.status, abandoned_at, collapsed_at  (00014)
--   colonies.last_upkeep_at, upkeep_missed_periods  (00019)
--   ships.dispatch_mode  (00016)
--   ships.auto_state, auto_target_colony_id  (00018)
--   player_stations table  (00016)
--   alliances.tag, invite_code  (00027)
--   players profile + lifecycle columns  (00029)
--
-- DATA REPAIR:
--   1. Backfill NULL timestamps on colonies
--   2. Create missing player_stations for all active players
--   3. Remove duplicate starter ships (keep oldest 2 per player)
-- ============================================================

-- ── 0. colony_status enum (safe if already exists) ───────────────────────

DO $$
BEGIN
  CREATE TYPE colony_status AS ENUM ('active', 'abandoned', 'collapsed');
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already created by migration 00014 — skip
END;
$$;

-- ── 1. colonies: lifecycle columns (from 00014, 00017, 00019) ────────────

ALTER TABLE colonies
  ADD COLUMN IF NOT EXISTS status               colony_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS abandoned_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS collapsed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_extract_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_upkeep_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS upkeep_missed_periods INTEGER NOT NULL DEFAULT 0;

-- Backfill any NULL timestamps so game logic has a valid baseline
UPDATE colonies SET last_extract_at = created_at WHERE last_extract_at IS NULL;
UPDATE colonies SET last_upkeep_at  = NOW()       WHERE last_upkeep_at  IS NULL;

-- Idempotent constraint adds (only added if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_colony_abandoned_at' AND conrelid = 'colonies'::regclass
  ) THEN
    ALTER TABLE colonies
      ADD CONSTRAINT chk_colony_abandoned_at
        CHECK (status != 'abandoned' OR abandoned_at IS NOT NULL);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_colony_collapsed_at' AND conrelid = 'colonies'::regclass
  ) THEN
    ALTER TABLE colonies
      ADD CONSTRAINT chk_colony_collapsed_at
        CHECK (status != 'collapsed' OR collapsed_at IS NOT NULL);
  END IF;
END;
$$;

-- Indexes for extraction and upkeep resolution queries
CREATE INDEX IF NOT EXISTS idx_colonies_extract
  ON colonies (owner_id, last_extract_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_colonies_upkeep
  ON colonies (owner_id, last_upkeep_at)
  WHERE status = 'active';

-- ── 2. ships: automation columns (from 00016, 00018) ─────────────────────

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS dispatch_mode TEXT NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  -- Add CHECK constraint only if missing (idempotent)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ships_dispatch_mode_check' AND conrelid = 'ships'::regclass
  ) THEN
    ALTER TABLE ships
      ADD CONSTRAINT ships_dispatch_mode_check
        CHECK (dispatch_mode IN ('manual', 'auto_collect_nearest', 'auto_collect_highest'));
  END IF;
END;
$$;

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS auto_state            TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_target_colony_id UUID DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ships_auto_state_check' AND conrelid = 'ships'::regclass
  ) THEN
    ALTER TABLE ships
      ADD CONSTRAINT ships_auto_state_check
        CHECK (auto_state IS NULL OR
               auto_state IN ('idle', 'traveling_to_colony', 'traveling_to_station'));
  END IF;
END;
$$;

-- Index for efficient auto-ship resolution on dashboard load
CREATE INDEX IF NOT EXISTS idx_ships_auto
  ON ships (owner_id, dispatch_mode)
  WHERE dispatch_mode IN ('auto_collect_nearest', 'auto_collect_highest');

-- ── 3. player_stations table (from 00016) ────────────────────────────────

CREATE TABLE IF NOT EXISTS player_stations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One station per player enforced by UNIQUE constraint.
  owner_id            UUID NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  current_system_id   TEXT NOT NULL DEFAULT 'sol',
  skin_entitlement_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger (guard: only create if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_player_stations_updated_at'
      AND tgrelid = 'player_stations'::regclass
  ) THEN
    CREATE TRIGGER set_player_stations_updated_at
      BEFORE UPDATE ON player_stations
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END;
$$;

-- RLS (safe to run even if already enabled)
ALTER TABLE player_stations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'player_stations'
      AND policyname = 'authenticated_read_stations'
  ) THEN
    DROP POLICY IF EXISTS "authenticated_read_stations" ON player_stations;
CREATE POLICY "authenticated_read_stations"
      ON player_stations FOR SELECT TO authenticated USING (TRUE);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_player_stations_owner
  ON player_stations (owner_id);

CREATE INDEX IF NOT EXISTS idx_player_stations_system
  ON player_stations (current_system_id);

-- ── 4. players: profile & lifecycle columns (from 00016, 00029) ──────────

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS sol_stipend_last_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS title               TEXT,
  ADD COLUMN IF NOT EXISTS bio                 TEXT,
  ADD COLUMN IF NOT EXISTS banner_id           TEXT,
  ADD COLUMN IF NOT EXISTS logo_id             TEXT,
  ADD COLUMN IF NOT EXISTS deactivated_at      TIMESTAMPTZ;

-- ── 5. alliances: tag and invite_code (from 00027) ───────────────────────

ALTER TABLE alliances
  ADD COLUMN IF NOT EXISTS tag         TEXT,
  ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- Backfill any NULL values (safe for empty tables)
UPDATE alliances
  SET tag = UPPER(LEFT(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'), 4))
  WHERE tag IS NULL;

UPDATE alliances
  SET invite_code = LOWER(LEFT(gen_random_uuid()::TEXT, 8))
  WHERE invite_code IS NULL;

-- Unique index on tag (case-insensitive) — idempotent
CREATE UNIQUE INDEX IF NOT EXISTS idx_alliances_tag
  ON alliances (lower(tag));

-- ── 6. DATA REPAIR: create missing player_stations ───────────────────────
--
-- Inserts one "Command Station" at Sol for every player who has no station.
-- Uses ON CONFLICT DO NOTHING for full safety (UNIQUE owner_id prevents
-- duplicate stations even under concurrent execution).
--
-- Note: players with deactivated_at set are included intentionally —
-- they may reactivate, and bootstrap will check for the station on login.

INSERT INTO player_stations (owner_id, name, current_system_id)
SELECT p.id, 'Command Station', 'sol'
FROM   players p
WHERE  NOT EXISTS (
  SELECT 1 FROM player_stations ps WHERE ps.owner_id = p.id
)
ON CONFLICT (owner_id) DO NOTHING;

-- ── 7. DATA REPAIR: remove duplicate starter ships ───────────────────────
--
-- The Phase 26 bootstrap bug (invalid .eq("status","active") filter on ships)
-- caused ships to be created on every page load rather than only once.
-- Each affected player may have dozens of duplicate "Pioneer I" / "Pioneer II"
-- ships beyond the intended 2.
--
-- Strategy: keep the 2 oldest ships per player (the original starters),
-- delete everything beyond position 2 in ascending created_at order.
--
-- This is safe because:
--   - No gameplay mechanism yet allows acquiring more than 2 ships
--   - Upgrades (hull_level etc.) are applied to the oldest ships first
--   - Fleet memberships, travel jobs, and cargo reference ship IDs;
--     cascades or SET NULL on FK ensure integrity
--
-- Resource inventory rows for deleted ships are removed via ON DELETE CASCADE
-- if the FK is set up that way, or explicitly cleaned up below.

-- Step A: identify ships to delete (row_number > 2 per owner)
CREATE TEMP TABLE IF NOT EXISTS _ships_to_delete AS
SELECT id
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at ASC) AS rn
  FROM ships
) ranked
WHERE rn > 2;

-- Step B: clean up resource_inventory rows for these ships
DELETE FROM resource_inventory
WHERE location_type = 'ship'
  AND location_id IN (SELECT id FROM _ships_to_delete);

-- Step C: delete the excess ships themselves
DELETE FROM ships
WHERE id IN (SELECT id FROM _ships_to_delete);

DROP TABLE IF EXISTS _ships_to_delete;

-- ── 8. Refresh PostgREST schema cache ────────────────────────────────────
--
-- When run via the Supabase dashboard SQL editor, this causes PostgREST
-- to reload its schema cache immediately so that newly added columns are
-- visible to the application without restarting the project.

NOTIFY pgrst, 'reload schema';


-- ---- 00031_phase28_gameplay.sql ----
-- ============================================================
-- Migration 00031: Phase 28 — Core Gameplay + Economy Rebalance
--
-- PURPOSE: Ship level defaults and speed backfill for the Phase 28
-- gameplay rebuild.
--
-- CHANGES:
--   1. Ship stat defaults: hull/engine/shield/utility start at level 1
--      (was 0). Cargo and turret remain at level 0.
--   2. Backfill existing ships to level 1 on key stats (using GREATEST
--      so players who already upgraded above 1 are unaffected).
--   3. Recalculate speed_ly_per_hr for all ships using the new formula:
--         speed = 10.0 + engine_level * 1.0
--      This matches BALANCE.shipUpgrades.baseSpeedLyPerHr = 10.0 and
--      BALANCE.shipUpgrades.speedPerLevel = 1.0.
--   4. Update the column DEFAULT so new ships created after this migration
--      get the correct speed.
--
-- All statements are safe to re-run (idempotent where possible).
-- ============================================================

-- ── 1. Backfill existing ship stat levels ────────────────────────────────
--
-- Raise hull/engine/shield/utility to at least 1 for every existing ship.
-- Ships that have already been upgraded (level > 1) are unaffected by GREATEST.

UPDATE ships
SET
  hull_level    = GREATEST(hull_level, 1),
  engine_level  = GREATEST(engine_level, 1),
  shield_level  = GREATEST(shield_level, 1),
  utility_level = GREATEST(utility_level, 1);

-- ── 2. Recalculate speed_ly_per_hr ────────────────────────────────────────
--
-- New formula: speed = 10.0 + engine_level * 1.0
-- All ships are updated so travel time calculations immediately reflect
-- the Phase 28 speed rebalance.

UPDATE ships
SET speed_ly_per_hr = 10.0 + (engine_level * 1.0);

-- ── 3. Change DEFAULT values for new ships ────────────────────────────────
--
-- New ships (created by bootstrap after this migration) will default to
-- level 1 for hull/engine/shield/utility and 11.0 speed.
-- The CHECK constraints already allow these values.

ALTER TABLE ships
  ALTER COLUMN hull_level    SET DEFAULT 1,
  ALTER COLUMN engine_level  SET DEFAULT 1,
  ALTER COLUMN shield_level  SET DEFAULT 1,
  ALTER COLUMN utility_level SET DEFAULT 1,
  ALTER COLUMN speed_ly_per_hr SET DEFAULT 11.0;

-- ── 4. Refresh PostgREST schema cache ────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- ---- 00032_phase30_stat_normalize.sql ----
-- Phase 30: Ship Stat Normalization
--
-- Goals:
--   1. Normalize cargo_level and turret_level to baseline 1 (matching
--      hull/engine/shield/utility which were set to 1 in Phase 28).
--   2. Sync cargo_cap with the new cargo_level=1 baseline so the DB column
--      matches the effectiveCargoCap formula (100 + level × 50).
--   3. Set column defaults to 1 for all six stats so future ships bootstrap
--      at the correct baseline without explicit inserts.

-- ── Normalize cargo_level 0 → 1 (and sync cargo_cap) ─────────────────────
UPDATE ships
SET   cargo_level = 1,
      cargo_cap   = 150    -- effectiveCargoCap(1) = 100 + 1×50
WHERE cargo_level = 0;

-- For ships where cargo_level > 0 but cargo_cap is stale (100 base not
-- updated after prior upgrades), recalculate to keep them consistent.
-- Formula: base(100) + cargo_level×50
UPDATE ships
SET cargo_cap = 100 + cargo_level * 50
WHERE cargo_cap <> 100 + cargo_level * 50;

-- ── Normalize turret_level 0 → 1 ──────────────────────────────────────────
UPDATE ships
SET turret_level = 1
WHERE turret_level = 0;

-- ── Set column defaults so new ships start at level 1 ─────────────────────
ALTER TABLE ships ALTER COLUMN cargo_level   SET DEFAULT 1;
ALTER TABLE ships ALTER COLUMN turret_level  SET DEFAULT 1;
ALTER TABLE ships ALTER COLUMN cargo_cap     SET DEFAULT 150;


-- ---- 00033_phase32_ship_state.sql ----
-- Phase 32: Unified Ship State
--
-- Adds three columns to ships:
--   ship_state            TEXT  -- authoritative single-field state
--   last_known_system_id  TEXT  -- always populated (even while traveling)
--   destination_system_id TEXT  -- populated while traveling; NULL when docked
--
-- IMPORTANT: system IDs are catalog text keys, NOT UUID foreign keys to any
-- DB table. No REFERENCES clause is used here. Existing travel/routing code
-- continues to join via travel_jobs.to_system_id when needed.
--
-- Backfill logic is idempotent: only rows still at the DEFAULT are touched.

-- 1. Add columns (idempotent via IF NOT EXISTS)
ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS ship_state TEXT
    NOT NULL DEFAULT 'idle_at_station'
    CHECK (ship_state IN (
      'idle_at_station',
      'idle_in_system',
      'assigned',
      'traveling',
      'loading',
      'unloading',
      'surveying',
      'harvesting',
      'fleet_traveling'
    )),
  ADD COLUMN IF NOT EXISTS last_known_system_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS destination_system_id TEXT DEFAULT NULL;

-- 2. Backfill ship_state from existing dispatch_mode / auto_state / location
--    Only touches rows that are still at the default value so re-runs are safe.
UPDATE ships
SET ship_state =
  CASE
    WHEN auto_state IN ('traveling_to_colony', 'traveling_to_station')
      THEN 'traveling'
    WHEN auto_state = 'idle'
      THEN 'idle_at_station'
    WHEN auto_state IS NULL AND current_system_id IS NOT NULL
      THEN 'idle_at_station'
    WHEN auto_state IS NULL AND current_system_id IS NULL
      THEN 'traveling'
    ELSE 'idle_at_station'
  END
WHERE ship_state = 'idle_at_station';  -- guard: only update default rows

-- 3. Backfill last_known_system_id for docked ships
UPDATE ships
SET last_known_system_id = current_system_id
WHERE current_system_id IS NOT NULL
  AND last_known_system_id IS NULL;

-- 4. Backfill last_known_system_id for in-transit ships from travel_jobs
UPDATE ships s
SET last_known_system_id = (
  SELECT tj.from_system_id
  FROM travel_jobs tj
  WHERE tj.ship_id = s.id
    AND tj.status  = 'pending'
  ORDER BY tj.created_at DESC
  LIMIT 1
)
WHERE s.current_system_id IS NULL
  AND s.last_known_system_id IS NULL;

-- 5. Backfill destination_system_id for currently-traveling ships
UPDATE ships s
SET destination_system_id = (
  SELECT tj.to_system_id
  FROM travel_jobs tj
  WHERE tj.ship_id = s.id
    AND tj.status  = 'pending'
  ORDER BY tj.created_at DESC
  LIMIT 1
)
WHERE s.ship_state = 'traveling'
  AND s.destination_system_id IS NULL;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_ships_ship_state
  ON ships (ship_state);

CREATE INDEX IF NOT EXISTS idx_ships_owner_ship_state
  ON ships (owner_id, ship_state);

CREATE INDEX IF NOT EXISTS idx_ships_last_known_system
  ON ships (last_known_system_id)
  WHERE last_known_system_id IS NOT NULL;


-- ---- 00034_phase32_routes.sql ----
-- Phase 32: Routes and Route Legs
--
-- Creates the routes and route_legs tables FIRST, then adds the
-- active_route_id FK column to ships. The FK constraint is intentionally
-- added AFTER the referenced table is created; this is the dependency-safe order.
--
-- Migration is idempotent via CREATE TABLE IF NOT EXISTS and
-- ADD COLUMN IF NOT EXISTS.

-- 1. Named logistics routes (one per player intent)
CREATE TABLE IF NOT EXISTS routes (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id            UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL DEFAULT '',
  route_type           TEXT        NOT NULL DEFAULT 'haul'
                         CHECK (route_type IN ('haul', 'survey', 'patrol', 'fleet_dispatch')),
  -- Where the route starts
  origin_type          TEXT        NOT NULL DEFAULT 'station'
                         CHECK (origin_type IN ('station', 'colony', 'system')),
  origin_id            TEXT        NOT NULL DEFAULT '',
  -- Where the route ends
  dest_type            TEXT        NOT NULL DEFAULT 'station'
                         CHECK (dest_type IN ('station', 'colony', 'system')),
  dest_id              TEXT        NOT NULL DEFAULT '',
  -- Automation policy (replaces per-ship dispatch_mode)
  haul_mode            TEXT        NOT NULL DEFAULT 'manual'
                         CHECK (haul_mode IN ('manual', 'auto_nearest', 'auto_highest', 'round_trip')),
  status               TEXT        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  -- Denormalised count for fast display; authoritative state is ships.active_route_id
  assigned_ship_count  INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Individual hops within a route
CREATE TABLE IF NOT EXISTS route_legs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id              UUID        NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  leg_index             INTEGER     NOT NULL,
  from_system_id        TEXT        NOT NULL,
  to_system_id          TEXT        NOT NULL,
  -- lane_id is NULL for same-system moves or direct warp
  lane_id               UUID        REFERENCES hyperspace_lanes(id) ON DELETE SET NULL,
  distance_ly           NUMERIC(8,4),
  estimated_duration_hr NUMERIC(8,4),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (route_id, leg_index)
);

-- 3. Add route assignment columns to ships
--    active_route_id FK is safe because routes table already exists above.
ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS active_route_id UUID
    REFERENCES routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_leg_index INTEGER NOT NULL DEFAULT 0;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_routes_player_status
  ON routes (player_id, status);

CREATE INDEX IF NOT EXISTS idx_route_legs_route_leg
  ON route_legs (route_id, leg_index);

CREATE INDEX IF NOT EXISTS idx_ships_active_route
  ON ships (active_route_id)
  WHERE active_route_id IS NOT NULL;

-- 5. Row-level security
ALTER TABLE routes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_legs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'routes' AND policyname = 'Players see own routes'
  ) THEN
    DROP POLICY IF EXISTS "Players see own routes" ON routes;
CREATE POLICY "Players see own routes"
      ON routes FOR ALL
      USING (
        player_id = (SELECT id FROM players WHERE auth_id = (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'route_legs' AND policyname = 'Players see own route legs'
  ) THEN
    DROP POLICY IF EXISTS "Players see own route legs" ON route_legs;
CREATE POLICY "Players see own route legs"
      ON route_legs FOR ALL
      USING (
        route_id IN (
          SELECT id FROM routes
          WHERE player_id = (SELECT id FROM players WHERE auth_id = (SELECT auth.uid()))
        )
      );
  END IF;
END;
$$;


-- ---- 00035_phase32_dev_role.sql ----
-- Phase 32: Developer Role in Database
--
-- Adds is_dev flag to players so dev tools can be gated by DB state rather
-- than only NODE_ENV. This enables dev tooling in staging, preview deployments,
-- and production test accounts without exposing them to all users.
--
-- To grant dev access after running this migration:
--   UPDATE players SET is_dev = TRUE WHERE handle = 'your-handle';
-- Or via the admin API endpoint /api/admin/set-dev (to be built separately).

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS is_dev BOOLEAN NOT NULL DEFAULT FALSE;

-- Sparse index (only indexes TRUE rows; keeps index tiny)
CREATE INDEX IF NOT EXISTS idx_players_is_dev
  ON players (id)
  WHERE is_dev = TRUE;


-- ---- 00036_phase32_rpcs.sql ----
-- Phase 32: Atomic Cargo Transfer RPCs
--
-- Postgres functions that replace the application-layer upsert patterns.
-- Using FOR UPDATE row-locking prevents double-spend in concurrent sessions.
-- All functions are SECURITY DEFINER so they bypass RLS while enforcing
-- their own business-logic guards.

-- ── transfer_cargo_to_station ──────────────────────────────────────────────
-- Atomically moves all cargo from a ship to a player station.
-- Returns total units transferred.
CREATE OR REPLACE FUNCTION transfer_cargo_to_station(
  p_ship_id    UUID,
  p_station_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r         RECORD;
  total_qty INTEGER := 0;
BEGIN
  -- Lock the ship row to serialise concurrent transfer attempts
  PERFORM id FROM ships WHERE id = p_ship_id FOR UPDATE;

  FOR r IN
    SELECT resource_type, quantity
    FROM resource_inventory
    WHERE location_type = 'ship'
      AND location_id   = p_ship_id
  LOOP
    INSERT INTO resource_inventory
      (location_type, location_id, resource_type, quantity)
    VALUES
      ('station', p_station_id, r.resource_type, r.quantity)
    ON CONFLICT (location_type, location_id, resource_type)
    DO UPDATE SET
      quantity   = resource_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();

    total_qty := total_qty + r.quantity;
  END LOOP;

  DELETE FROM resource_inventory
  WHERE location_type = 'ship'
    AND location_id   = p_ship_id;

  RETURN total_qty;
END;
$$;

-- ── transfer_cargo_from_colony ─────────────────────────────────────────────
-- Atomically loads colony resources into a ship up to its cargo_cap.
-- Returns total units loaded.
CREATE OR REPLACE FUNCTION transfer_cargo_from_colony(
  p_ship_id   UUID,
  p_colony_id UUID,
  p_cargo_cap INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r             RECORD;
  current_cargo INTEGER;
  space_left    INTEGER;
  to_load       INTEGER;
  total_loaded  INTEGER := 0;
BEGIN
  PERFORM id FROM ships WHERE id = p_ship_id FOR UPDATE;

  SELECT COALESCE(SUM(quantity), 0) INTO current_cargo
  FROM resource_inventory
  WHERE location_type = 'ship'
    AND location_id   = p_ship_id;

  space_left := p_cargo_cap - current_cargo;
  IF space_left <= 0 THEN RETURN 0; END IF;

  FOR r IN
    SELECT resource_type, quantity
    FROM resource_inventory
    WHERE location_type = 'colony'
      AND location_id   = p_colony_id
    ORDER BY resource_type  -- deterministic order
  LOOP
    EXIT WHEN space_left <= 0;

    to_load := LEAST(r.quantity, space_left);

    UPDATE resource_inventory
    SET
      quantity   = quantity - to_load,
      updated_at = NOW()
    WHERE location_type = 'colony'
      AND location_id   = p_colony_id
      AND resource_type = r.resource_type;

    -- Remove zero-quantity rows to keep the table clean
    DELETE FROM resource_inventory
    WHERE location_type = 'colony'
      AND location_id   = p_colony_id
      AND resource_type = r.resource_type
      AND quantity      = 0;

    INSERT INTO resource_inventory
      (location_type, location_id, resource_type, quantity)
    VALUES
      ('ship', p_ship_id, r.resource_type, to_load)
    ON CONFLICT (location_type, location_id, resource_type)
    DO UPDATE SET
      quantity   = resource_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();

    space_left   := space_left - to_load;
    total_loaded := total_loaded + to_load;
  END LOOP;

  RETURN total_loaded;
END;
$$;

-- ── dev_grant_resources ────────────────────────────────────────────────────
-- Dev-only: adds resources to any inventory location.
-- The granting player must have is_dev = TRUE (checked inside the function).
CREATE OR REPLACE FUNCTION dev_grant_resources(
  p_location_type      TEXT,
  p_location_id        UUID,
  p_resource_type      TEXT,
  p_quantity           INTEGER,
  p_granting_player_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM players
    WHERE id     = p_granting_player_id
      AND is_dev = TRUE
  ) THEN
    RAISE EXCEPTION 'dev_grant_resources: caller % is not a dev player',
      p_granting_player_id;
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'dev_grant_resources: quantity must be positive, got %',
      p_quantity;
  END IF;

  IF p_location_type NOT IN ('station', 'colony', 'ship', 'alliance_storage') THEN
    RAISE EXCEPTION 'dev_grant_resources: invalid location_type %',
      p_location_type;
  END IF;

  INSERT INTO resource_inventory
    (location_type, location_id, resource_type, quantity)
  VALUES
    (p_location_type, p_location_id, p_resource_type, p_quantity)
  ON CONFLICT (location_type, location_id, resource_type)
  DO UPDATE SET
    quantity   = resource_inventory.quantity + EXCLUDED.quantity,
    updated_at = NOW();
END;
$$;


-- ---- 00037_phase32_views.sql ----
-- Phase 32: Helper Views
--
-- DEPENDENCY: Requires 00033_phase32_ship_state.sql to have run first,
-- because ship_positions references the ship_state column added in that migration.
--
-- These views are CREATE OR REPLACE, so they are safe to re-run.

-- ── ship_positions ─────────────────────────────────────────────────────────
-- Current or last-known location of every ship, with optional travel fraction
-- for animated interpolation on the map (0.0 = just departed, 1.0 = arrived).
CREATE OR REPLACE VIEW ship_positions AS
SELECT
  s.id                     AS ship_id,
  s.owner_id,
  s.name,
  s.ship_state,
  s.last_known_system_id,
  s.destination_system_id,
  s.current_system_id,
  tj.depart_at,
  tj.arrive_at,
  CASE
    WHEN s.ship_state = 'traveling'
     AND tj.id IS NOT NULL
     AND EXTRACT(EPOCH FROM (tj.arrive_at - tj.depart_at)) > 0
    THEN
      LEAST(1.0, GREATEST(0.0,
        EXTRACT(EPOCH FROM (NOW() - tj.depart_at))::NUMERIC
        / EXTRACT(EPOCH FROM (tj.arrive_at - tj.depart_at))::NUMERIC
      ))
    ELSE NULL
  END                      AS travel_fraction,
  s.active_route_id,
  s.route_leg_index
FROM ships s
LEFT JOIN travel_jobs tj
  ON  tj.ship_id = s.id
  AND tj.status  = 'pending';

-- ── lane_graph ─────────────────────────────────────────────────────────────
-- Active hyperspace lanes for client-side pathfinding and map rendering.
CREATE OR REPLACE VIEW lane_graph AS
SELECT
  hl.id               AS lane_id,
  hl.from_system_id,
  hl.to_system_id,
  hl.access_level,
  hl.transit_tax_rate,
  hl.owner_id,
  hl.alliance_id
FROM hyperspace_lanes hl
WHERE hl.is_active = TRUE;


-- ---- 00038_phase33_stabilization.sql ----
-- ============================================================
-- Migration 00038: Phase 33 — Schema stabilization (idempotent repair)
--
-- PURPOSE: Ensure DB instances that may have missed migrations 00016–00021
-- have the correct schema for Phase 32+ gameplay. All statements are
-- idempotent (IF NOT EXISTS / DROP … IF EXISTS).
--
-- FIXES:
--   1. resource_inventory.location_type constraint includes 'station'
--      (some DBs only ran 00007 and missed the extension in 00016)
--   2. ships stat-level columns (hull/engine/shield/utility/cargo/turret)
--      added with DEFAULT 1 if missing; defaults updated if stale
--   3. ships state/route columns (ship_state, last_known_system_id, etc.)
--      added if missing
--   4. RLS on resource_inventory extended to include 'station' rows
--   5. Backfill: existing ships raised to at least level 1; last_known_system_id
--      populated from current_system_id for docked ships
-- ============================================================

-- ── 1. Fix resource_inventory check constraint ────────────────────────────
-- Drop the old constraint (regardless of current values) and re-add with
-- the full set of valid location types.

ALTER TABLE resource_inventory
  DROP CONSTRAINT IF EXISTS resource_inventory_location_type_check;

ALTER TABLE resource_inventory
  ADD CONSTRAINT resource_inventory_location_type_check
    CHECK (location_type IN ('colony', 'ship', 'alliance_storage', 'station'));

-- ── 2. Ship stat-level columns (from migrations 00021, 00031, 00032) ──────

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS hull_level    INTEGER NOT NULL DEFAULT 1
    CHECK (hull_level    >= 0 AND hull_level    <= 10),
  ADD COLUMN IF NOT EXISTS shield_level  INTEGER NOT NULL DEFAULT 1
    CHECK (shield_level  >= 0 AND shield_level  <= 10),
  ADD COLUMN IF NOT EXISTS cargo_level   INTEGER NOT NULL DEFAULT 1
    CHECK (cargo_level   >= 0 AND cargo_level   <= 10),
  ADD COLUMN IF NOT EXISTS engine_level  INTEGER NOT NULL DEFAULT 1
    CHECK (engine_level  >= 0 AND engine_level  <= 10),
  ADD COLUMN IF NOT EXISTS turret_level  INTEGER NOT NULL DEFAULT 1
    CHECK (turret_level  >= 0 AND turret_level  <= 10),
  ADD COLUMN IF NOT EXISTS utility_level INTEGER NOT NULL DEFAULT 1
    CHECK (utility_level >= 0 AND utility_level <= 10);

-- Update defaults for columns that may have been added earlier with DEFAULT 0
ALTER TABLE ships
  ALTER COLUMN hull_level    SET DEFAULT 1,
  ALTER COLUMN engine_level  SET DEFAULT 1,
  ALTER COLUMN shield_level  SET DEFAULT 1,
  ALTER COLUMN utility_level SET DEFAULT 1,
  ALTER COLUMN cargo_level   SET DEFAULT 1,
  ALTER COLUMN turret_level  SET DEFAULT 1,
  ALTER COLUMN cargo_cap     SET DEFAULT 150,
  ALTER COLUMN speed_ly_per_hr SET DEFAULT 11.0;

-- Backfill existing ships: raise all stat levels to at least 1
UPDATE ships
SET
  hull_level    = GREATEST(hull_level,    1),
  engine_level  = GREATEST(engine_level,  1),
  shield_level  = GREATEST(shield_level,  1),
  utility_level = GREATEST(utility_level, 1),
  cargo_level   = GREATEST(cargo_level,   1),
  turret_level  = GREATEST(turret_level,  1);

-- ── 3. Ship automation columns (from migration 00016, 00018) ─────────────

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS dispatch_mode TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS auto_state            TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_target_colony_id UUID DEFAULT NULL;

-- ── 4. Ship state + route columns (from migrations 00033, 00034) ──────────

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS ship_state TEXT NOT NULL DEFAULT 'idle_at_station';

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS last_known_system_id  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS destination_system_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS route_leg_index       INTEGER NOT NULL DEFAULT 0;

-- Backfill last_known_system_id for docked ships
UPDATE ships
SET last_known_system_id = current_system_id
WHERE current_system_id IS NOT NULL
  AND last_known_system_id IS NULL;

-- ── 5. Fix RLS policy for resource_inventory (add 'station' arm) ──────────
-- Drop and recreate the select policy so it recognises player-owned stations.

DROP POLICY IF EXISTS "own_resource_inventory" ON resource_inventory;

DROP POLICY IF EXISTS "own_resource_inventory" ON resource_inventory;
CREATE POLICY "own_resource_inventory"
  ON resource_inventory FOR SELECT
  TO authenticated
  USING (
    (location_type = 'colony' AND EXISTS (
      SELECT 1 FROM colonies
      WHERE id = location_id AND owner_id = auth_player_id()
    )) OR
    (location_type = 'ship' AND EXISTS (
      SELECT 1 FROM ships
      WHERE id = location_id AND owner_id = auth_player_id()
    )) OR
    (location_type = 'alliance_storage' AND EXISTS (
      SELECT 1 FROM alliance_members
      WHERE alliance_id = location_id AND player_id = auth_player_id()
    )) OR
    (location_type = 'station' AND EXISTS (
      SELECT 1 FROM player_stations
      WHERE id = location_id AND owner_id = auth_player_id()
    ))
  );

-- ── 6. Ensure player_stations exists (defensive — may already exist) ──────
CREATE TABLE IF NOT EXISTS player_stations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  current_system_id   TEXT NOT NULL DEFAULT 'sol',
  skin_entitlement_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE player_stations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'player_stations'
      AND policyname = 'authenticated_read_stations'
  ) THEN
    DROP POLICY IF EXISTS "authenticated_read_stations" ON player_stations;
CREATE POLICY "authenticated_read_stations"
      ON player_stations FOR SELECT TO authenticated USING (TRUE);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_player_stations_owner
  ON player_stations (owner_id);

CREATE INDEX IF NOT EXISTS idx_player_stations_system
  ON player_stations (current_system_id);

-- ── 7. Create missing player_stations for existing players ────────────────
INSERT INTO player_stations (owner_id, name, current_system_id)
SELECT p.id, 'Command Station', 'sol'
FROM   players p
WHERE  NOT EXISTS (
  SELECT 1 FROM player_stations ps WHERE ps.owner_id = p.id
)
ON CONFLICT (owner_id) DO NOTHING;

-- ── 8. Refresh PostgREST schema cache ────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ---- 00039_fix_resource_inventory_constraint.sql ----
-- ============================================================
-- Migration 00039: Fix resource_inventory location_type constraint
--
-- PURPOSE: Ensure the live DB constraint includes 'station'.
-- Some instances that skipped or partially applied migration 00016
-- (or 00038) still have the original 3-value constraint from 00007:
--   CHECK (location_type IN ('colony', 'ship', 'alliance_storage'))
-- which rejects any write with location_type = 'station', breaking:
--   - dev_grant_resources() RPC
--   - POST /api/game/ship/unload
--   - engineTick station inventory writes
--   - travelResolution auto-unload
--
-- SAFE: DROP IF EXISTS + ADD is idempotent — harmless if 00038 already ran.
-- ============================================================

ALTER TABLE resource_inventory
  DROP CONSTRAINT IF EXISTS resource_inventory_location_type_check;

ALTER TABLE resource_inventory
  ADD CONSTRAINT resource_inventory_location_type_check
    CHECK (location_type IN ('colony', 'ship', 'alliance_storage', 'station'));

-- Reload PostgREST schema cache so the new constraint is visible immediately.
NOTIFY pgrst, 'reload schema';


-- ---- 00040_colony_slots_expansion.sql ----
-- ============================================================
-- Migration 00040: Colony slots expansion
--
-- The original default of colony_slots = 1 is far too low for
-- the intended logistics-network gameplay. Players need room to
-- build out multi-system colony networks before hitting a wall.
--
-- New progression:
--   Base (default)   : 20 slots
--   Upgrade 1        : 30 slots  (future milestone)
--   Upgrade 2        : 40 slots  (future milestone)
--   Unlimited tier   : 9999      (sentinel — effectively uncapped)
--
-- This migration:
--   1. Changes the column default to 20 for all new players
--   2. Raises every existing player to at least 20 slots
--      (does not reduce anyone who already has > 20)
-- ============================================================

-- 1. Update the column default
ALTER TABLE players
  ALTER COLUMN colony_slots SET DEFAULT 20;

-- 2. Bring all existing players up to the new base floor
UPDATE players
SET colony_slots = 20
WHERE colony_slots < 20;

NOTIFY pgrst, 'reload schema';


-- ---- 00041_ship_pinned_colony.sql ----
-- ============================================================
-- Migration 00041: Ship pinned-colony assignment
--
-- Adds a player-settable pinned_colony_id to ships so that the
-- owner can explicitly assign a ship to haul from a specific
-- colony. This is separate from auto_target_colony_id, which is
-- a transient field set/cleared by the auto-haul state machine.
--
-- Behaviour:
--   - pinned_colony_id = NULL  → auto-haul uses nearest/highest logic
--   - pinned_colony_id set     → auto-haul prefers that colony first
--   - Switching mode (manual ↔ auto) does NOT clear the assignment
--   - Deleting a colony sets pinned_colony_id = NULL via FK cascade
-- ============================================================

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS pinned_colony_id UUID
    REFERENCES colonies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ships_pinned_colony
  ON ships (pinned_colony_id)
  WHERE pinned_colony_id IS NOT NULL;


-- ---- 00042_multiplayer_visibility.sql ----
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
DROP POLICY IF EXISTS "body_stewardship_public_read" ON body_stewardship;
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

-- Permit data is world-visible (admin-client access only in Phase 1).
-- All reads go through the admin client which bypasses RLS entirely.
DROP POLICY IF EXISTS "colony_permits_read_by_involved" ON colony_permits;
DROP POLICY IF EXISTS "colony_permits_public_read" ON colony_permits;
CREATE POLICY "colony_permits_public_read"
  ON colony_permits FOR SELECT USING (true);

-- All writes go through admin client (service role bypasses RLS).


