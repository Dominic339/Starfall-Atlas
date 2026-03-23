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
