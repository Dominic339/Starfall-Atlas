-- Phase 3 economy: stewards configure a default permit tax rate on their bodies.
-- When a non-steward founds a colony here, a colony_permits row is auto-created
-- with this rate by the colony/found API route.

ALTER TABLE body_stewardship
  ADD COLUMN IF NOT EXISTS default_tax_rate_pct SMALLINT NOT NULL DEFAULT 0
    CHECK (default_tax_rate_pct >= 0 AND default_tax_rate_pct <= 50);
