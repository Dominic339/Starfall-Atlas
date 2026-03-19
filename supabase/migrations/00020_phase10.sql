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

CREATE POLICY "player_research_select_own"
  ON player_research FOR SELECT
  USING (player_id = auth.uid()::uuid);
