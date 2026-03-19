-- ============================================================
-- Migration 00008: Markets and auctions
-- All credit transfers are server-side only. Listing fees are
-- burned (tracked via a separate accounting mechanism in app).
-- Auctions use escrow rows in auction_bids.
-- ============================================================

-- Market listings: sell orders and buy orders
CREATE TABLE market_listings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id         TEXT NOT NULL,
  -- seller_id populated for sell orders; NULL for pure buy orders
  seller_id         UUID REFERENCES players(id),
  -- buyer_id populated for buy orders; NULL for sell listings
  buyer_id          UUID REFERENCES players(id),
  side              order_side NOT NULL,
  resource_type     TEXT NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  quantity_filled   INTEGER NOT NULL DEFAULT 0
                      CHECK (quantity_filled >= 0),
  price_per_unit    BIGINT NOT NULL CHECK (price_per_unit > 0),
  -- 2% listing fee deducted at creation, tracked for accounting
  listing_fee_paid  BIGINT NOT NULL DEFAULT 0
                      CHECK (listing_fee_paid >= 0),
  -- Credits held in escrow for buy orders
  escrow_held       BIGINT NOT NULL DEFAULT 0
                      CHECK (escrow_held >= 0),
  -- Physical location of goods (relevant for sell orders)
  system_id         TEXT NOT NULL,
  status            order_status NOT NULL DEFAULT 'open',
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_market_listings_updated_at
  BEFORE UPDATE ON market_listings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Enforce: sell orders must have seller_id, buy orders must have buyer_id
ALTER TABLE market_listings
  ADD CONSTRAINT chk_listing_owner
    CHECK (
      (side = 'sell' AND seller_id IS NOT NULL) OR
      (side = 'buy'  AND buyer_id  IS NOT NULL)
    );

-- Immutable log of matched trades (append-only)
CREATE TABLE market_trades (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sell_listing_id   UUID NOT NULL REFERENCES market_listings(id),
  buy_listing_id    UUID NOT NULL REFERENCES market_listings(id),
  region_id         TEXT NOT NULL,
  resource_type     TEXT NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  price_per_unit    BIGINT NOT NULL CHECK (price_per_unit > 0),
  total_credits     BIGINT NOT NULL CHECK (total_credits > 0),
  executed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Claim tickets: issued to buyers after a market match.
-- Buyer must physically send a ship to the listing system to collect.
CREATE TABLE claim_tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id      UUID NOT NULL REFERENCES market_trades(id),
  buyer_id      UUID NOT NULL REFERENCES players(id),
  system_id     TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  claimed       BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at    TIMESTAMPTZ,
  -- Unclaimed tickets expire (default 7 days; set by application)
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auctions for colony sites, systems, ships, or items
CREATE TABLE auctions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         UUID NOT NULL REFERENCES players(id),
  -- 'colony' | 'system' | 'ship' | 'item'
  item_type         TEXT NOT NULL
                      CHECK (item_type IN ('colony', 'system', 'ship', 'item')),
  -- UUID or system_id of the auctioned entity
  item_id           TEXT NOT NULL,
  min_bid           BIGINT NOT NULL DEFAULT 0
                      CHECK (min_bid >= 0),
  current_high_bid  BIGINT NOT NULL DEFAULT 0
                      CHECK (current_high_bid >= 0),
  high_bidder_id    UUID REFERENCES players(id),
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  status            auction_status NOT NULL DEFAULT 'active',
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_auctions_updated_at
  BEFORE UPDATE ON auctions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Bids with escrow tracking.
-- escrow_held = TRUE while bid is the current high bid.
-- Set to FALSE when outbid (credits returned to bidder by app).
CREATE TABLE auction_bids (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  UUID NOT NULL REFERENCES auctions(id),
  bidder_id   UUID NOT NULL REFERENCES players(id),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  escrow_held BOOLEAN NOT NULL DEFAULT TRUE,
  placed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
