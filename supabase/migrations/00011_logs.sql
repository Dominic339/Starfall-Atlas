-- ============================================================
-- Migration 00011: World events log
-- Append-only table. Never UPDATE or DELETE rows.
-- Powers the discovery feed and world changes feed in the UI.
-- ============================================================

CREATE TABLE world_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  world_event_type NOT NULL,
  -- The player who triggered the event (NULL for system events)
  player_id   UUID REFERENCES players(id) ON DELETE SET NULL,
  system_id   TEXT,
  body_id     TEXT,
  -- Event-specific data (e.g. { "buyer_id": "...", "credits": 5000 })
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No UPDATE trigger — this table is append-only by design.
-- Application code must never issue UPDATE or DELETE on world_events.
