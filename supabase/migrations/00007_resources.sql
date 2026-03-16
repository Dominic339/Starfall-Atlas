-- ============================================================
-- Migration 00007: Resource inventory
-- A single polymorphic table covers colony, ship, and alliance
-- storage. location_type discriminates the source.
-- CHECK (quantity >= 0) prevents negative inventory at DB level.
-- ============================================================

CREATE TABLE resource_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'colony' | 'ship' | 'alliance_storage'
  location_type TEXT NOT NULL
                  CHECK (location_type IN ('colony', 'ship', 'alliance_storage')),
  -- References colonies(id), ships(id), or alliances(id) depending on location_type.
  -- Enforced by application logic; no DB FK due to polymorphism.
  location_id   UUID NOT NULL,
  resource_type TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 0
                  CHECK (quantity >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One row per (location, resource_type) combination
  UNIQUE (location_type, location_id, resource_type)
);

CREATE TRIGGER set_resource_inventory_updated_at
  BEFORE UPDATE ON resource_inventory
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
