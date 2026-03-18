-- ============================================================
-- Migration 00006: Travel jobs
-- Records a ship's transit between two systems.
-- arrive_at is computed server-side (depart_at + duration).
-- lane_id is NULL for pre-catalog warp tunnel premium items.
-- ============================================================

CREATE TABLE travel_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_id           UUID NOT NULL REFERENCES ships(id),
  player_id         UUID NOT NULL REFERENCES players(id),
  from_system_id    TEXT NOT NULL,
  to_system_id      TEXT NOT NULL,
  -- NULL for Unstable Warp Tunnel (premium item, no physical lane)
  lane_id           UUID REFERENCES hyperspace_lanes(id),
  depart_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arrive_at         TIMESTAMPTZ NOT NULL,
  -- Credits deducted from player at arrival resolution
  transit_tax_paid  BIGINT NOT NULL DEFAULT 0
                      CHECK (transit_tax_paid >= 0),
  status            job_status NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
