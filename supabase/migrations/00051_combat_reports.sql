-- ============================================================
-- Migration 00051: Ship-vs-ship combat reports
-- Stores the outcome of fleet interceptions.
-- ============================================================

CREATE TYPE combat_outcome AS ENUM ('attacker_wins', 'defender_wins', 'draw');

CREATE TABLE combat_reports (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_id       UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  defender_id       UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  system_id         TEXT        NOT NULL,
  outcome           combat_outcome NOT NULL,
  attacker_power    INTEGER     NOT NULL,
  defender_power    INTEGER     NOT NULL,
  -- Ships lost on each side (snapshot count)
  attacker_ships_lost INTEGER   NOT NULL DEFAULT 0,
  defender_ships_lost INTEGER   NOT NULL DEFAULT 0,
  -- Credits looted from defender (transferred to attacker on win)
  credits_looted    BIGINT      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookups by participant
CREATE INDEX idx_combat_reports_attacker ON combat_reports(attacker_id, created_at DESC);
CREATE INDEX idx_combat_reports_defender ON combat_reports(defender_id, created_at DESC);
