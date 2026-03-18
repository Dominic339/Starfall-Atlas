-- ============================================================
-- Migration 00001: Enum types
-- All enums used across the Starfall Atlas schema.
-- ============================================================

-- Job / async action status (travel, construction, survey)
CREATE TYPE job_status AS ENUM (
  'pending',
  'complete',
  'cancelled',
  'failed'
);

-- Hyperspace lane access control
CREATE TYPE lane_access AS ENUM (
  'public',
  'alliance_only',
  'private'
);

-- Alliance membership tiers
CREATE TYPE alliance_role AS ENUM (
  'founder',
  'officer',
  'member'
);

-- Buildable structure types on colony bodies
CREATE TYPE structure_type AS ENUM (
  'extractor',
  'warehouse',
  'shipyard',      -- post-alpha only
  'trade_hub',
  'relay_station'
);

-- Market order side
CREATE TYPE order_side AS ENUM (
  'sell',
  'buy'
);

-- Market order lifecycle
CREATE TYPE order_status AS ENUM (
  'open',
  'filled',
  'partially_filled',
  'expired',
  'cancelled'
);

-- Auction lifecycle
CREATE TYPE auction_status AS ENUM (
  'active',
  'resolved',
  'cancelled'
);

-- World changes feed event types
CREATE TYPE world_event_type AS ENUM (
  'system_discovered',
  'colony_founded',
  'colony_sold',
  'system_sold',
  'alliance_formed',
  'alliance_dissolved',
  'lane_built'
);

-- Premium shop item types
CREATE TYPE premium_item_type AS ENUM (
  'ship_skin',
  'colony_banner',
  'vanity_name_tag',
  'alliance_emblem',
  'discoverer_monument',
  'unstable_warp_tunnel',
  'stabilized_wormhole',
  'deep_survey_kit',
  'colony_permit'
);

-- Reusable trigger function: set updated_at to NOW() on any UPDATE
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
