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

CREATE POLICY "fleet_slots_select_own" ON player_fleet_slots
  FOR SELECT USING (player_id = auth.uid()::uuid);
