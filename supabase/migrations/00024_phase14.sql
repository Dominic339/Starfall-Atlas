-- Phase 14: Colony Structures and Colony Tech Wiring
--
-- Changes:
--   1. Add 'habitat_module' to the structure_type enum
--   2. Drop the extractor-only resource constraint (no longer needed in Phase 14
--      where extractors give a yield bonus without a fixed resource type)
--   3. Add UNIQUE (colony_id, type): one structure of each type per colony

-- ── 1. Extend the enum ────────────────────────────────────────────────────────
ALTER TYPE structure_type ADD VALUE IF NOT EXISTS 'habitat_module';

-- ── 2. Drop old extractor constraint ─────────────────────────────────────────
ALTER TABLE structures DROP CONSTRAINT IF EXISTS chk_extractor_resource;

-- ── 3. One structure per type per colony ─────────────────────────────────────
ALTER TABLE structures
  ADD CONSTRAINT structures_colony_type_unique UNIQUE (colony_id, type);
