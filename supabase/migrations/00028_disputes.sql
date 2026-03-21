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

-- One active cooldown per beacon (latest wins; old ones expire naturally)
CREATE UNIQUE INDEX IF NOT EXISTS idx_beacon_cooldowns_beacon_active
  ON beacon_cooldowns(beacon_id)
  WHERE expires_at > NOW();

-- ── 4. Lock column on fleets ─────────────────────────────────────────────────

ALTER TABLE fleets
  ADD COLUMN IF NOT EXISTS dispute_commit_id UUID
    REFERENCES disputes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fleets_dispute_commit
  ON fleets(dispute_commit_id)
  WHERE dispute_commit_id IS NOT NULL;
