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
