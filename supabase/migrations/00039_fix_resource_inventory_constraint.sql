-- ============================================================
-- Migration 00039: Fix resource_inventory location_type constraint
--
-- PURPOSE: Ensure the live DB constraint includes 'station'.
-- Some instances that skipped or partially applied migration 00016
-- (or 00038) still have the original 3-value constraint from 00007:
--   CHECK (location_type IN ('colony', 'ship', 'alliance_storage'))
-- which rejects any write with location_type = 'station', breaking:
--   - dev_grant_resources() RPC
--   - POST /api/game/ship/unload
--   - engineTick station inventory writes
--   - travelResolution auto-unload
--
-- SAFE: DROP IF EXISTS + ADD is idempotent — harmless if 00038 already ran.
-- ============================================================

ALTER TABLE resource_inventory
  DROP CONSTRAINT IF EXISTS resource_inventory_location_type_check;

ALTER TABLE resource_inventory
  ADD CONSTRAINT resource_inventory_location_type_check
    CHECK (location_type IN ('colony', 'ship', 'alliance_storage', 'station'));

-- Reload PostgREST schema cache so the new constraint is visible immediately.
NOTIFY pgrst, 'reload schema';
