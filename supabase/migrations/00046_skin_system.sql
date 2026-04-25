-- Phase 46: Skin system
--
-- Adds cosmetic skin support: skin catalog, player ownership, equipped slots,
-- and shop packages/deals with time limits and discounts.

-- ── Skin catalog ──────────────────────────────────────────────────────────────
-- Mirrors the TypeScript definitions in src/skins/index.ts.
-- Admins (is_dev = true) manage this table via the in-game dev tool.

CREATE TABLE IF NOT EXISTS skins (
  id                   TEXT        PRIMARY KEY,  -- slug matching src/skins/ definition
  name                 TEXT        NOT NULL,
  description          TEXT        NOT NULL DEFAULT '',
  type                 TEXT        NOT NULL CHECK (type IN ('ship', 'station', 'fleet')),
  rarity               TEXT        NOT NULL DEFAULT 'common'
                                    CHECK (rarity IN ('common', 'uncommon', 'rare', 'legendary')),
  -- Pricing: either in-game credits, real-money cents, or both
  price_credits        INT         NOT NULL DEFAULT 0 CHECK (price_credits >= 0),
  price_premium_cents  INT         CHECK (price_premium_cents IS NULL OR price_premium_cents >= 0),
  -- Availability window
  is_available         BOOLEAN     NOT NULL DEFAULT FALSE,
  available_from       TIMESTAMPTZ,
  available_until      TIMESTAMPTZ,
  -- Optional discount (0–100 %)
  discount_pct         INT         CHECK (discount_pct IS NULL OR (discount_pct >= 0 AND discount_pct <= 100)),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Shop packages ─────────────────────────────────────────────────────────────
-- A package bundles multiple skins at a combined deal price.

CREATE TABLE IF NOT EXISTS skin_packages (
  id                   TEXT        PRIMARY KEY,
  name                 TEXT        NOT NULL,
  description          TEXT        NOT NULL DEFAULT '',
  price_credits        INT         CHECK (price_credits IS NULL OR price_credits >= 0),
  price_premium_cents  INT         CHECK (price_premium_cents IS NULL OR price_premium_cents >= 0),
  is_available         BOOLEAN     NOT NULL DEFAULT FALSE,
  available_from       TIMESTAMPTZ,
  available_until      TIMESTAMPTZ,
  discount_pct         INT         CHECK (discount_pct IS NULL OR (discount_pct >= 0 AND discount_pct <= 100)),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skin_package_items (
  package_id TEXT NOT NULL REFERENCES skin_packages (id) ON DELETE CASCADE,
  skin_id    TEXT NOT NULL REFERENCES skins (id) ON DELETE CASCADE,
  PRIMARY KEY (package_id, skin_id)
);

-- ── Player ownership ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS player_skins (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID        NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  skin_id     TEXT        NOT NULL REFERENCES skins (id),
  source      TEXT        NOT NULL DEFAULT 'purchase'
                           CHECK (source IN ('purchase', 'package', 'gift', 'dev')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, skin_id)
);

CREATE INDEX IF NOT EXISTS idx_player_skins_player ON player_skins (player_id);

-- ── Equipped skins (one row per player) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS player_equipped_skins (
  player_id       UUID NOT NULL PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
  ship_skin_id    TEXT REFERENCES skins (id) ON DELETE SET NULL,
  station_skin_id TEXT REFERENCES skins (id) ON DELETE SET NULL,
  fleet_skin_id   TEXT REFERENCES skins (id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Purchase ledger ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS skin_purchases (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID        NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  skin_id     TEXT        REFERENCES skins (id),
  package_id  TEXT        REFERENCES skin_packages (id),
  credits_paid INT,
  premium_cents_paid INT,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Either skin_id or package_id must be set
  CHECK ((skin_id IS NOT NULL) OR (package_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_skin_purchases_player ON skin_purchases (player_id);
