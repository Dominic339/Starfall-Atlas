-- Phase 14: Premium mobility lane extensions
--
-- Adds two columns to hyperspace_lanes:
--   expires_at  — set for Unstable Warp Tunnels (NULL = permanent)
--   is_one_way  — TRUE for warp tunnels (cannot be traversed in reverse)

ALTER TABLE hyperspace_lanes
  ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_one_way  BOOLEAN NOT NULL DEFAULT FALSE;

-- Index so lazy expiry sweeps are fast
CREATE INDEX IF NOT EXISTS idx_lanes_expires
  ON hyperspace_lanes (expires_at)
  WHERE expires_at IS NOT NULL;
