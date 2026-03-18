-- ============================================================
-- Migration 00017: Phase 6 — colony growth and resource extraction
--
-- 1. Add last_extract_at column to colonies
-- 2. Enable RLS on resource_inventory + add ownership policy
-- 3. Add indexes for extraction queries
-- ============================================================

-- ============================================================
-- 1. Colony extraction timer
-- ============================================================

-- Nullable; initialized to created_at for existing rows so that
-- extraction starts accruing retroactively from colony founding.
ALTER TABLE colonies
  ADD COLUMN IF NOT EXISTS last_extract_at TIMESTAMPTZ;

-- Back-fill existing colonies: extraction begins from colony creation.
UPDATE colonies
  SET last_extract_at = created_at
  WHERE last_extract_at IS NULL;

-- ============================================================
-- 2. Resource inventory RLS
-- The table was created in 00007 without RLS. Admin client
-- bypasses RLS for all server-side writes; these policies
-- guard future direct client access only.
-- ============================================================

ALTER TABLE resource_inventory ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read inventory for locations they own.
-- Uses auth_player_id() helper defined in 00013.
CREATE POLICY "read_own_resource_inventory"
  ON resource_inventory FOR SELECT TO authenticated
  USING (
    (location_type = 'station' AND location_id IN (
      SELECT id FROM player_stations WHERE owner_id = auth_player_id()
    ))
    OR
    (location_type = 'ship' AND location_id IN (
      SELECT id FROM ships WHERE owner_id = auth_player_id()
    ))
    OR
    (location_type = 'colony' AND location_id IN (
      SELECT id FROM colonies WHERE owner_id = auth_player_id()
    ))
  );

-- ============================================================
-- 3. Indexes
-- ============================================================

-- Resource inventory: most common lookup is (location_type, location_id)
CREATE INDEX IF NOT EXISTS idx_resource_inv_location
  ON resource_inventory (location_type, location_id);

-- Colony extraction queries: owner + status + last_extract_at
CREATE INDEX IF NOT EXISTS idx_colonies_extract
  ON colonies (owner_id, last_extract_at)
  WHERE status = 'active';

-- Player station owner lookup (used on every dashboard load)
CREATE INDEX IF NOT EXISTS idx_player_stations_owner
  ON player_stations (owner_id);
