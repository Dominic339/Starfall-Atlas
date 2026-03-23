-- Phase 32: Helper Views
--
-- DEPENDENCY: Requires 00033_phase32_ship_state.sql to have run first,
-- because ship_positions references the ship_state column added in that migration.
--
-- These views are CREATE OR REPLACE, so they are safe to re-run.

-- ── ship_positions ─────────────────────────────────────────────────────────
-- Current or last-known location of every ship, with optional travel fraction
-- for animated interpolation on the map (0.0 = just departed, 1.0 = arrived).
CREATE OR REPLACE VIEW ship_positions AS
SELECT
  s.id                     AS ship_id,
  s.owner_id,
  s.name,
  s.ship_state,
  s.last_known_system_id,
  s.destination_system_id,
  s.current_system_id,
  tj.depart_at,
  tj.arrive_at,
  CASE
    WHEN s.ship_state = 'traveling'
     AND tj.id IS NOT NULL
     AND EXTRACT(EPOCH FROM (tj.arrive_at - tj.depart_at)) > 0
    THEN
      LEAST(1.0, GREATEST(0.0,
        EXTRACT(EPOCH FROM (NOW() - tj.depart_at))::NUMERIC
        / EXTRACT(EPOCH FROM (tj.arrive_at - tj.depart_at))::NUMERIC
      ))
    ELSE NULL
  END                      AS travel_fraction,
  s.active_route_id,
  s.route_leg_index
FROM ships s
LEFT JOIN travel_jobs tj
  ON  tj.ship_id = s.id
  AND tj.status  = 'pending';

-- ── lane_graph ─────────────────────────────────────────────────────────────
-- Active hyperspace lanes for client-side pathfinding and map rendering.
CREATE OR REPLACE VIEW lane_graph AS
SELECT
  hl.id               AS lane_id,
  hl.from_system_id,
  hl.to_system_id,
  hl.access_level,
  hl.transit_tax_rate,
  hl.owner_id,
  hl.alliance_id
FROM hyperspace_lanes hl
WHERE hl.is_active = TRUE;
