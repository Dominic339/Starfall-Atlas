-- ============================================================
-- Migration 00010: Premium entitlements
-- Consumable items set consumed = TRUE server-side.
-- Cosmetic items are never consumed.
-- purchase_ref is the payment provider transaction ID.
-- ============================================================

CREATE TABLE premium_entitlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_type       premium_item_type NOT NULL,
  -- Item-specific configuration stored as JSONB.
  -- Examples:
  --   ship_skin:        { "skin_id": "nebula_blue" }
  --   vanity_name_tag:  { "system_id": "12345", "label": "New Hope" }
  --   colony_banner:    { "colony_id": "<uuid>", "banner_id": "flag_v2" }
  --   unstable_warp_tunnel: {}   (no config needed; target chosen at use time)
  item_config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  consumed        BOOLEAN NOT NULL DEFAULT FALSE,
  consumed_at     TIMESTAMPTZ,
  -- External payment provider transaction ID (Stripe charge ID, etc.)
  purchase_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce: consumed_at must be set when consumed = TRUE
ALTER TABLE premium_entitlements
  ADD CONSTRAINT chk_consumed_timestamp
    CHECK (consumed = FALSE OR consumed_at IS NOT NULL);

-- Now that premium_entitlements exists, add cosmetic FKs
ALTER TABLE ships
  ADD CONSTRAINT fk_ship_skin
    FOREIGN KEY (skin_entitlement_id) REFERENCES premium_entitlements(id)
    ON DELETE SET NULL;

ALTER TABLE alliances
  ADD CONSTRAINT fk_alliance_emblem
    FOREIGN KEY (emblem_entitlement_id) REFERENCES premium_entitlements(id)
    ON DELETE SET NULL;
