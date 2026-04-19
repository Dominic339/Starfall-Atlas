-- Phase 15: In-game messaging
--
-- Two message types:
--   1. Direct messages between players (player_messages)
--   2. Alliance broadcast messages (alliance_messages)
--
-- Both tables are append-only in spirit (we never hard-delete; we soft-delete
-- for sender by setting deleted_by_sender; recipient can also soft-delete).

CREATE TABLE player_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  recipient_id    UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject         TEXT        NOT NULL DEFAULT '' CHECK (char_length(subject) <= 80),
  body            TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at         TIMESTAMPTZ,
  deleted_sender  BOOLEAN     NOT NULL DEFAULT FALSE,
  deleted_recipient BOOLEAN   NOT NULL DEFAULT FALSE,
  CONSTRAINT no_self_message CHECK (sender_id <> recipient_id)
);

CREATE TABLE alliance_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_id     UUID        NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  sender_id       UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  body            TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE INDEX idx_player_messages_recipient
  ON player_messages (recipient_id, sent_at DESC)
  WHERE deleted_recipient = FALSE;

CREATE INDEX idx_player_messages_sender
  ON player_messages (sender_id, sent_at DESC)
  WHERE deleted_sender = FALSE;

CREATE INDEX idx_alliance_messages_alliance
  ON alliance_messages (alliance_id, sent_at DESC);

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE player_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alliance_messages ENABLE ROW LEVEL SECURITY;

-- Players may read their own messages (sent or received)
CREATE POLICY "player_messages_own"
  ON player_messages FOR SELECT
  USING (
    sender_id    = (SELECT id FROM players WHERE auth_id = auth.uid()) OR
    recipient_id = (SELECT id FROM players WHERE auth_id = auth.uid())
  );

-- Alliance messages: readable by any alliance member
CREATE POLICY "alliance_messages_member"
  ON alliance_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM alliance_members am
       WHERE am.alliance_id = alliance_messages.alliance_id
         AND am.player_id = (SELECT id FROM players WHERE auth_id = auth.uid())
    )
  );
