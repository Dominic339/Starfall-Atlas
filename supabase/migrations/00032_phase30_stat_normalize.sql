-- Phase 30: Ship Stat Normalization
--
-- Goals:
--   1. Normalize cargo_level and turret_level to baseline 1 (matching
--      hull/engine/shield/utility which were set to 1 in Phase 28).
--   2. Sync cargo_cap with the new cargo_level=1 baseline so the DB column
--      matches the effectiveCargoCap formula (100 + level × 50).
--   3. Set column defaults to 1 for all six stats so future ships bootstrap
--      at the correct baseline without explicit inserts.

-- ── Normalize cargo_level 0 → 1 (and sync cargo_cap) ─────────────────────
UPDATE ships
SET   cargo_level = 1,
      cargo_cap   = 150    -- effectiveCargoCap(1) = 100 + 1×50
WHERE cargo_level = 0;

-- For ships where cargo_level > 0 but cargo_cap is stale (100 base not
-- updated after prior upgrades), recalculate to keep them consistent.
-- Formula: base(100) + cargo_level×50
UPDATE ships
SET cargo_cap = 100 + cargo_level * 50
WHERE cargo_cap <> 100 + cargo_level * 50;

-- ── Normalize turret_level 0 → 1 ──────────────────────────────────────────
UPDATE ships
SET turret_level = 1
WHERE turret_level = 0;

-- ── Set column defaults so new ships start at level 1 ─────────────────────
ALTER TABLE ships ALTER COLUMN cargo_level   SET DEFAULT 1;
ALTER TABLE ships ALTER COLUMN turret_level  SET DEFAULT 1;
ALTER TABLE ships ALTER COLUMN cargo_cap     SET DEFAULT 150;
