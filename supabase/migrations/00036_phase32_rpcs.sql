-- Phase 32: Atomic Cargo Transfer RPCs
--
-- Postgres functions that replace the application-layer upsert patterns.
-- Using FOR UPDATE row-locking prevents double-spend in concurrent sessions.
-- All functions are SECURITY DEFINER so they bypass RLS while enforcing
-- their own business-logic guards.

-- ── transfer_cargo_to_station ──────────────────────────────────────────────
-- Atomically moves all cargo from a ship to a player station.
-- Returns total units transferred.
CREATE OR REPLACE FUNCTION transfer_cargo_to_station(
  p_ship_id    UUID,
  p_station_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r         RECORD;
  total_qty INTEGER := 0;
BEGIN
  -- Lock the ship row to serialise concurrent transfer attempts
  PERFORM id FROM ships WHERE id = p_ship_id FOR UPDATE;

  FOR r IN
    SELECT resource_type, quantity
    FROM resource_inventory
    WHERE location_type = 'ship'
      AND location_id   = p_ship_id
  LOOP
    INSERT INTO resource_inventory
      (location_type, location_id, resource_type, quantity)
    VALUES
      ('station', p_station_id, r.resource_type, r.quantity)
    ON CONFLICT (location_type, location_id, resource_type)
    DO UPDATE SET
      quantity   = resource_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();

    total_qty := total_qty + r.quantity;
  END LOOP;

  DELETE FROM resource_inventory
  WHERE location_type = 'ship'
    AND location_id   = p_ship_id;

  RETURN total_qty;
END;
$$;

-- ── transfer_cargo_from_colony ─────────────────────────────────────────────
-- Atomically loads colony resources into a ship up to its cargo_cap.
-- Returns total units loaded.
CREATE OR REPLACE FUNCTION transfer_cargo_from_colony(
  p_ship_id   UUID,
  p_colony_id UUID,
  p_cargo_cap INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r             RECORD;
  current_cargo INTEGER;
  space_left    INTEGER;
  to_load       INTEGER;
  total_loaded  INTEGER := 0;
BEGIN
  PERFORM id FROM ships WHERE id = p_ship_id FOR UPDATE;

  SELECT COALESCE(SUM(quantity), 0) INTO current_cargo
  FROM resource_inventory
  WHERE location_type = 'ship'
    AND location_id   = p_ship_id;

  space_left := p_cargo_cap - current_cargo;
  IF space_left <= 0 THEN RETURN 0; END IF;

  FOR r IN
    SELECT resource_type, quantity
    FROM resource_inventory
    WHERE location_type = 'colony'
      AND location_id   = p_colony_id
    ORDER BY resource_type  -- deterministic order
  LOOP
    EXIT WHEN space_left <= 0;

    to_load := LEAST(r.quantity, space_left);

    UPDATE resource_inventory
    SET
      quantity   = quantity - to_load,
      updated_at = NOW()
    WHERE location_type = 'colony'
      AND location_id   = p_colony_id
      AND resource_type = r.resource_type;

    -- Remove zero-quantity rows to keep the table clean
    DELETE FROM resource_inventory
    WHERE location_type = 'colony'
      AND location_id   = p_colony_id
      AND resource_type = r.resource_type
      AND quantity      = 0;

    INSERT INTO resource_inventory
      (location_type, location_id, resource_type, quantity)
    VALUES
      ('ship', p_ship_id, r.resource_type, to_load)
    ON CONFLICT (location_type, location_id, resource_type)
    DO UPDATE SET
      quantity   = resource_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();

    space_left   := space_left - to_load;
    total_loaded := total_loaded + to_load;
  END LOOP;

  RETURN total_loaded;
END;
$$;

-- ── dev_grant_resources ────────────────────────────────────────────────────
-- Dev-only: adds resources to any inventory location.
-- The granting player must have is_dev = TRUE (checked inside the function).
CREATE OR REPLACE FUNCTION dev_grant_resources(
  p_location_type      TEXT,
  p_location_id        UUID,
  p_resource_type      TEXT,
  p_quantity           INTEGER,
  p_granting_player_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM players
    WHERE id     = p_granting_player_id
      AND is_dev = TRUE
  ) THEN
    RAISE EXCEPTION 'dev_grant_resources: caller % is not a dev player',
      p_granting_player_id;
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'dev_grant_resources: quantity must be positive, got %',
      p_quantity;
  END IF;

  IF p_location_type NOT IN ('station', 'colony', 'ship', 'alliance_storage') THEN
    RAISE EXCEPTION 'dev_grant_resources: invalid location_type %',
      p_location_type;
  END IF;

  INSERT INTO resource_inventory
    (location_type, location_id, resource_type, quantity)
  VALUES
    (p_location_type, p_location_id, p_resource_type, p_quantity)
  ON CONFLICT (location_type, location_id, resource_type)
  DO UPDATE SET
    quantity   = resource_inventory.quantity + EXCLUDED.quantity,
    updated_at = NOW();
END;
$$;
