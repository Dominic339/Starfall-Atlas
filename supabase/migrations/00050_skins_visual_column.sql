-- Phase 50: Add visual JSONB column to skins table
--
-- Allows DB-only skins (created via admin tool without a code definition)
-- to store their visual properties (color, accentColor, shape) in the database.
-- Code-defined skins continue to use their TypeScript visual definition;
-- this column acts as a fallback / override for admin-created skins.

ALTER TABLE skins ADD COLUMN IF NOT EXISTS visual JSONB NOT NULL DEFAULT '{}';
