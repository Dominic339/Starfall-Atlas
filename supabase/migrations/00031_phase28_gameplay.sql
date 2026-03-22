-- ============================================================
-- Migration 00031: Phase 28 — Core Gameplay + Economy Rebalance
--
-- PURPOSE: Ship level defaults and speed backfill for the Phase 28
-- gameplay rebuild.
--
-- CHANGES:
--   1. Ship stat defaults: hull/engine/shield/utility start at level 1
--      (was 0). Cargo and turret remain at level 0.
--   2. Backfill existing ships to level 1 on key stats (using GREATEST
--      so players who already upgraded above 1 are unaffected).
--   3. Recalculate speed_ly_per_hr for all ships using the new formula:
--         speed = 10.0 + engine_level * 1.0
--      This matches BALANCE.shipUpgrades.baseSpeedLyPerHr = 10.0 and
--      BALANCE.shipUpgrades.speedPerLevel = 1.0.
--   4. Update the column DEFAULT so new ships created after this migration
--      get the correct speed.
--
-- All statements are safe to re-run (idempotent where possible).
-- ============================================================

-- ── 1. Backfill existing ship stat levels ────────────────────────────────
--
-- Raise hull/engine/shield/utility to at least 1 for every existing ship.
-- Ships that have already been upgraded (level > 1) are unaffected by GREATEST.

UPDATE ships
SET
  hull_level    = GREATEST(hull_level, 1),
  engine_level  = GREATEST(engine_level, 1),
  shield_level  = GREATEST(shield_level, 1),
  utility_level = GREATEST(utility_level, 1);

-- ── 2. Recalculate speed_ly_per_hr ────────────────────────────────────────
--
-- New formula: speed = 10.0 + engine_level * 1.0
-- All ships are updated so travel time calculations immediately reflect
-- the Phase 28 speed rebalance.

UPDATE ships
SET speed_ly_per_hr = 10.0 + (engine_level * 1.0);

-- ── 3. Change DEFAULT values for new ships ────────────────────────────────
--
-- New ships (created by bootstrap after this migration) will default to
-- level 1 for hull/engine/shield/utility and 11.0 speed.
-- The CHECK constraints already allow these values.

ALTER TABLE ships
  ALTER COLUMN hull_level    SET DEFAULT 1,
  ALTER COLUMN engine_level  SET DEFAULT 1,
  ALTER COLUMN shield_level  SET DEFAULT 1,
  ALTER COLUMN utility_level SET DEFAULT 1,
  ALTER COLUMN speed_ly_per_hr SET DEFAULT 11.0;

-- ── 4. Refresh PostgREST schema cache ────────────────────────────────────

NOTIFY pgrst, 'reload schema';
