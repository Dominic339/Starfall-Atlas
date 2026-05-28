-- Migration 00051: Hero ship system
--
-- Extends the ships table with commander (hero) properties.
-- One ship per player is designated as the hero/flagship.
-- Heroes have a class that grants passive bonuses and accumulate
-- XP from game actions to level up (levels 1–20).
--
-- Hero classes:
--   pathfinder   — faster travel, range bonus
--   warlord      — stronger in disputes, fleet power
--   merchant     — reduced market fees, better transit tax
--   industrialist— higher extraction rate
--   engineer     — faster/cheaper construction
--   raider       — higher asteroid harvest power

ALTER TABLE ships
  ADD COLUMN IF NOT EXISTS is_hero     BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hero_class  TEXT
    CHECK (hero_class IN ('pathfinder','warlord','merchant','industrialist','engineer','raider')),
  ADD COLUMN IF NOT EXISTS hero_level  SMALLINT NOT NULL DEFAULT 1
    CHECK (hero_level BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS hero_xp     INTEGER  NOT NULL DEFAULT 0
    CHECK (hero_xp >= 0);

-- Each player may have at most one hero ship
CREATE UNIQUE INDEX IF NOT EXISTS idx_ships_hero_per_player
  ON ships (owner_id)
  WHERE is_hero = true;

-- Fast lookup of a player's hero ship
CREATE INDEX IF NOT EXISTS idx_ships_is_hero
  ON ships (owner_id, is_hero)
  WHERE is_hero = true;
