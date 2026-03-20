-- Phase 11: Ship Upgrades and Tier Enforcement
--
-- Adds 6 per-stat upgrade level columns to the ships table.
-- All levels start at 0. Research controls the cap on each level (via
-- researchHelpers.maxStatLevel) and on the sum of all levels per ship
-- (via researchHelpers.maxTotalShipUpgrades).
--
-- Wired effects (derived stat updated on upgrade):
--   cargo_level  → cargo_cap  = 100 + cargo_level  × 50
--   engine_level → speed_ly_per_hr = 1.0 + engine_level × 0.2
--
-- Scaffold (tracked but no active gameplay effect yet):
--   hull_level, shield_level, turret_level, utility_level
--
-- DB-level CHECK constraints cap each column at the absolute maximum (10).
-- Research-based soft caps are enforced in the upgrade route.

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS hull_level    INTEGER NOT NULL DEFAULT 0
    CHECK (hull_level    >= 0 AND hull_level    <= 10),
  ADD COLUMN IF NOT EXISTS shield_level  INTEGER NOT NULL DEFAULT 0
    CHECK (shield_level  >= 0 AND shield_level  <= 10),
  ADD COLUMN IF NOT EXISTS cargo_level   INTEGER NOT NULL DEFAULT 0
    CHECK (cargo_level   >= 0 AND cargo_level   <= 10),
  ADD COLUMN IF NOT EXISTS engine_level  INTEGER NOT NULL DEFAULT 0
    CHECK (engine_level  >= 0 AND engine_level  <= 10),
  ADD COLUMN IF NOT EXISTS turret_level  INTEGER NOT NULL DEFAULT 0
    CHECK (turret_level  >= 0 AND turret_level  <= 10),
  ADD COLUMN IF NOT EXISTS utility_level INTEGER NOT NULL DEFAULT 0
    CHECK (utility_level >= 0 AND utility_level <= 10);
