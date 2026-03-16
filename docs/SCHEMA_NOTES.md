# Starfall Atlas — Schema Notes

> Version: 0.1 (Alpha Design)
> Last updated: 2026-03-16

This document describes the Supabase/Postgres data model for Starfall Atlas. It is a design reference for writing migrations. All entity names and column names here should be used consistently across migrations, application code, and type definitions.

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Enums](#2-enums)
3. [Players](#3-players)
4. [World: Discoveries and Surveys](#4-world-discoveries-and-surveys)
5. [Colonies and Structures](#5-colonies-and-structures)
6. [Travel Jobs](#6-travel-jobs)
7. [Resources and Inventories](#7-resources-and-inventories)
8. [Hyperspace Lanes](#8-hyperspace-lanes)
9. [Markets](#9-markets)
10. [Auctions](#10-auctions)
11. [Alliances](#11-alliances)
12. [Premium Entitlements](#12-premium-entitlements)
13. [Logs](#13-logs)
14. [Relationship Summary](#14-relationship-summary)
15. [Actions Requiring Transactions / Locking](#15-actions-requiring-transactions--locking)

---

## 1. Conventions

- All tables use `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- All tables have `created_at TIMESTAMPTZ DEFAULT NOW()` and `updated_at TIMESTAMPTZ DEFAULT NOW()`.
- Foreign keys reference `players(id)` as `player_id`, or more specific names where clarity demands it (e.g., `owner_id`, `builder_id`).
- `system_id` and `body_id` are string identifiers derived from the star catalog (not UUIDs) — they are stable cross-environment references into the deterministic world. Format: `system_id` is the HYG catalog ID as a string; `body_id` is `{system_id}:{body_index}`.
- Timestamps used for job completion use the pattern `{action}_at` (e.g., `arrive_at`, `complete_at`).
- Soft-deletes are not used. Rows are deleted or marked with a status enum.

---

## 2. Enums

```sql
-- Job and action status
CREATE TYPE job_status AS ENUM ('pending', 'complete', 'cancelled', 'failed');

-- Lane access level
CREATE TYPE lane_access AS ENUM ('public', 'alliance_only', 'private');

-- Alliance membership tier
CREATE TYPE alliance_role AS ENUM ('founder', 'officer', 'member');

-- Structure type
CREATE TYPE structure_type AS ENUM (
  'extractor',
  'warehouse',
  'shipyard',
  'trade_hub',
  'relay_station'
);

-- Market order side
CREATE TYPE order_side AS ENUM ('sell', 'buy');

-- Market order status
CREATE TYPE order_status AS ENUM ('open', 'filled', 'partially_filled', 'expired', 'cancelled');

-- Auction status
CREATE TYPE auction_status AS ENUM ('active', 'resolved', 'cancelled');

-- World change event type
CREATE TYPE world_event_type AS ENUM (
  'system_discovered',
  'colony_founded',
  'colony_sold',
  'system_sold',
  'alliance_formed',
  'alliance_dissolved',
  'lane_built'
);

-- Premium item type
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
```

---

## 3. Players

### `players`

Linked to Supabase Auth via `auth_id = auth.users.id`.

```sql
CREATE TABLE players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id         UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  handle          TEXT NOT NULL UNIQUE,           -- display name, immutable after set
  credits         BIGINT NOT NULL DEFAULT 0,      -- in-game currency
  colony_slots    SMALLINT NOT NULL DEFAULT 1,    -- max colonies allowed
  colony_permits_used SMALLINT NOT NULL DEFAULT 0, -- tracks premium Colony Permit usage (max 2)
  first_colony_placed BOOLEAN NOT NULL DEFAULT FALSE, -- gates pre-colony free travel
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- `credits` is managed server-side only. Never expose a client write path.
- `colony_slots` starts at 1. Incremented by gameplay milestones or Colony Permit premium item.
- `first_colony_placed` is set to TRUE when the player's first colony claim resolves. This ends free pre-colony lane travel.

---

## 4. World: Discoveries and Surveys

### `system_discoveries`

Records which players have discovered which systems.

```sql
CREATE TABLE system_discoveries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id   TEXT NOT NULL,
  player_id   UUID NOT NULL REFERENCES players(id),
  is_first    BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE for the very first discoverer
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (system_id, player_id)
);
```

**Notes**:
- `system_id` is from the star catalog (not a FK to a Supabase table — world data is not stored).
- `is_first` is set TRUE only if no prior row exists for this `system_id`. Managed in a transaction.

### `survey_jobs`

Tracks in-progress and completed surveys of system bodies.

```sql
CREATE TABLE survey_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id),
  system_id     TEXT NOT NULL,
  body_id       TEXT NOT NULL,
  ship_id       UUID NOT NULL REFERENCES ships(id),
  is_deep       BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE if Deep Survey Kit used
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  complete_at   TIMESTAMPTZ NOT NULL,
  status        job_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `survey_results`

Stores revealed resource profiles for surveyed bodies. Shared once revealed.

```sql
CREATE TABLE survey_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id     TEXT NOT NULL,
  body_id       TEXT NOT NULL UNIQUE,
  revealed_by   UUID NOT NULL REFERENCES players(id),  -- first surveyor
  resource_nodes JSONB NOT NULL DEFAULT '[]',
  -- resource_nodes: [{ type: string, quantity: integer, is_rare: boolean }]
  has_deep_nodes BOOLEAN NOT NULL DEFAULT FALSE,        -- TRUE if deep survey has been done
  deep_nodes     JSONB NOT NULL DEFAULT '[]',
  first_surveyed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- `resource_nodes` is a JSONB array, since node count per body is bounded and small.
- Once a body is surveyed, its results are visible to all players (no per-player survey result rows).

---

## 5. Colonies and Structures

### `colonies`

```sql
CREATE TABLE colonies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID NOT NULL REFERENCES players(id),
  system_id             TEXT NOT NULL,
  body_id               TEXT NOT NULL UNIQUE,  -- one colony per body
  population_tier       SMALLINT NOT NULL DEFAULT 1,
  next_growth_at        TIMESTAMPTZ,           -- NULL until growth conditions met
  last_tax_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  storage_cap           INTEGER NOT NULL DEFAULT 1000,  -- units of resource storage
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- `body_id` has a UNIQUE constraint — only one colony per body is allowed.
- `last_tax_collected_at` is used for lazy tax calculation.
- `storage_cap` is increased by Warehouse structures.

### `system_ownership`

Tracks which player owns a system's anchor point (giving lane-building and royalty rights).

```sql
CREATE TABLE system_ownership (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id   TEXT NOT NULL UNIQUE,
  owner_id    UUID NOT NULL REFERENCES players(id),
  royalty_rate SMALLINT NOT NULL DEFAULT 0  CHECK (royalty_rate BETWEEN 0 AND 20),
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `structures`

```sql
CREATE TABLE structures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colony_id       UUID NOT NULL REFERENCES colonies(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL REFERENCES players(id),
  type            structure_type NOT NULL,
  tier            SMALLINT NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,  -- FALSE until construction complete
  built_at        TIMESTAMPTZ,                     -- NULL until complete
  last_extract_at TIMESTAMPTZ,                     -- for Extractors: last extraction tick
  extract_resource_type TEXT,                      -- for Extractors: which resource
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `construction_jobs`

```sql
CREATE TABLE construction_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id  UUID NOT NULL REFERENCES structures(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  complete_at   TIMESTAMPTZ NOT NULL,
  status        job_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. Travel Jobs

### `ships`

```sql
CREATE TABLE ships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES players(id),
  name            TEXT NOT NULL,
  speed_ly_per_hr NUMERIC NOT NULL DEFAULT 1.0,
  cargo_cap       INTEGER NOT NULL DEFAULT 100,
  current_system_id TEXT,        -- NULL if in transit
  current_body_id   TEXT,        -- NULL if not landed
  skin_id           TEXT,        -- premium cosmetic
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `travel_jobs`

```sql
CREATE TABLE travel_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_id         UUID NOT NULL REFERENCES ships(id),
  player_id       UUID NOT NULL REFERENCES players(id),
  from_system_id  TEXT NOT NULL,
  to_system_id    TEXT NOT NULL,
  lane_id         UUID REFERENCES hyperspace_lanes(id),  -- NULL for pre-colony free warp tunnel
  depart_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arrive_at       TIMESTAMPTZ NOT NULL,
  transit_tax_paid BIGINT NOT NULL DEFAULT 0,
  status          job_status NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 7. Resources and Inventories

### `resource_inventory`

A single unified inventory table for colonies, ships, and alliance storage. Discriminated by `location_type` and `location_id`.

```sql
CREATE TABLE resource_inventory (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_type   TEXT NOT NULL CHECK (location_type IN ('colony', 'ship', 'alliance_storage')),
  location_id     UUID NOT NULL,
  resource_type   TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_type, location_id, resource_type)
);
```

**Notes**:
- `location_id` references `colonies(id)`, `ships(id)`, or `alliances(id)` depending on `location_type`. No FK enforced at DB level due to polymorphism; enforced by application logic.
- `quantity` has a `CHECK >= 0` constraint to prevent negative inventory.

---

## 8. Hyperspace Lanes

### `hyperspace_lanes`

```sql
CREATE TABLE hyperspace_lanes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES players(id),
  from_system_id    TEXT NOT NULL,
  to_system_id      TEXT NOT NULL,
  access_level      lane_access NOT NULL DEFAULT 'public',
  transit_tax_rate  SMALLINT NOT NULL DEFAULT 0  CHECK (transit_tax_rate BETWEEN 0 AND 5),
  -- transit_tax_rate is percentage (0-5%). Flat cap is enforced in application logic.
  is_active         BOOLEAN NOT NULL DEFAULT FALSE,  -- FALSE until construction complete
  built_at          TIMESTAMPTZ,
  alliance_id       UUID REFERENCES alliances(id),   -- if access_level = 'alliance_only'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_system_id, to_system_id)
);
```

### `lane_construction_jobs`

```sql
CREATE TABLE lane_construction_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_id     UUID NOT NULL REFERENCES hyperspace_lanes(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES players(id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  complete_at TIMESTAMPTZ NOT NULL,
  status      job_status NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 9. Markets

### `market_listings`

```sql
CREATE TABLE market_listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id       TEXT NOT NULL,  -- seed-defined region identifier
  seller_id       UUID REFERENCES players(id),  -- NULL for buy orders
  buyer_id        UUID REFERENCES players(id),  -- NULL for sell listings
  side            order_side NOT NULL,
  resource_type   TEXT NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  quantity_filled INTEGER NOT NULL DEFAULT 0,
  price_per_unit  BIGINT NOT NULL CHECK (price_per_unit > 0),
  listing_fee_paid BIGINT NOT NULL DEFAULT 0,
  escrow_held     BIGINT NOT NULL DEFAULT 0,  -- credits held for buy orders
  system_id       TEXT NOT NULL,  -- where the goods are physically located (sell orders)
  status          order_status NOT NULL DEFAULT 'open',
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `market_trades`

Immutable log of matched trades.

```sql
CREATE TABLE market_trades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sell_listing_id UUID NOT NULL REFERENCES market_listings(id),
  buy_listing_id  UUID NOT NULL REFERENCES market_listings(id),
  region_id       TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  quantity        INTEGER NOT NULL,
  price_per_unit  BIGINT NOT NULL,
  total_credits   BIGINT NOT NULL,
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `claim_tickets`

Issued to buyers after a trade matches. Represents the right to pick up goods.

```sql
CREATE TABLE claim_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        UUID NOT NULL REFERENCES market_trades(id),
  buyer_id        UUID NOT NULL REFERENCES players(id),
  system_id       TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  quantity        INTEGER NOT NULL,
  claimed         BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at      TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 10. Auctions

### `auctions`

```sql
CREATE TABLE auctions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL REFERENCES players(id),
  item_type       TEXT NOT NULL,   -- 'colony', 'system', 'ship', 'item'
  item_id         TEXT NOT NULL,   -- ID of the thing being auctioned (colony UUID, system_id, etc.)
  min_bid         BIGINT NOT NULL CHECK (min_bid >= 0),
  current_high_bid BIGINT NOT NULL DEFAULT 0,
  high_bidder_id  UUID REFERENCES players(id),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  status          auction_status NOT NULL DEFAULT 'active',
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `auction_bids`

```sql
CREATE TABLE auction_bids (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  UUID NOT NULL REFERENCES auctions(id),
  bidder_id   UUID NOT NULL REFERENCES players(id),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  escrow_held BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE when outbid and refunded
  placed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 11. Alliances

### `alliances`

```sql
CREATE TABLE alliances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  founder_id      UUID NOT NULL REFERENCES players(id),
  member_count    SMALLINT NOT NULL DEFAULT 1,
  emblem_id       TEXT,  -- premium cosmetic
  dissolved_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `alliance_members`

```sql
CREATE TABLE alliance_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_id   UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id),
  role          alliance_role NOT NULL DEFAULT 'member',
  alliance_credits BIGINT NOT NULL DEFAULT 0,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id)  -- one alliance per player
);
```

**Notes**:
- The UNIQUE constraint on `player_id` enforces the one-alliance-per-player rule.

### `alliance_goals`

```sql
CREATE TABLE alliance_goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_id     UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES players(id),
  title           TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  quantity_target INTEGER NOT NULL CHECK (quantity_target > 0),
  quantity_filled INTEGER NOT NULL DEFAULT 0,
  credit_reward   BIGINT NOT NULL DEFAULT 0,  -- Alliance Credits paid out on completion
  deadline_at     TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  expired         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `alliance_goal_contributions`

```sql
CREATE TABLE alliance_goal_contributions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id       UUID NOT NULL REFERENCES alliance_goals(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id),
  resource_type TEXT NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  contributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 12. Premium Entitlements

### `premium_entitlements`

```sql
CREATE TABLE premium_entitlements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id),
  item_type     premium_item_type NOT NULL,
  item_config   JSONB NOT NULL DEFAULT '{}',
  -- item_config examples:
  --   ship_skin:        { "skin_id": "nebula_blue" }
  --   vanity_name_tag:  { "system_id": "12345", "label": "New Hope" }
  --   colony_banner:    { "colony_id": "uuid", "banner_id": "flag_v2" }
  consumed      BOOLEAN NOT NULL DEFAULT FALSE,
  consumed_at   TIMESTAMPTZ,
  purchase_ref  TEXT,  -- payment provider transaction ID
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- Consumable items (warp tunnel, wormhole, survey kit, colony permit) set `consumed = TRUE` when used, server-side.
- Cosmetic items are never consumed.

---

## 13. Logs

### `world_events`

Append-only log of major world events. Powers the discovery feed and world changes feed.

```sql
CREATE TABLE world_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  world_event_type NOT NULL,
  player_id   UUID REFERENCES players(id),
  system_id   TEXT,
  body_id     TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- Rows are never updated. The log is append-only.
- `metadata` holds event-specific details (e.g., for `colony_sold`: `{ "buyer_id": "...", "credits": 5000 }`).

---

## 14. Relationship Summary

```
players
  ├── ships (owner_id)
  ├── colonies (owner_id)
  ├── system_ownership (owner_id)
  ├── system_discoveries (player_id)
  ├── survey_jobs (player_id)
  ├── travel_jobs (player_id)
  ├── hyperspace_lanes (owner_id)
  ├── market_listings (seller_id / buyer_id)
  ├── auctions (seller_id)
  ├── auction_bids (bidder_id)
  ├── alliance_members (player_id) → alliances
  └── premium_entitlements (player_id)

colonies
  ├── structures (colony_id)
  └── construction_jobs → structures

alliances
  ├── alliance_members (alliance_id)
  ├── alliance_goals (alliance_id)
  └── resource_inventory (location_type='alliance_storage', location_id=alliance.id)

resource_inventory
  ├── colony (location_type='colony', location_id=colony.id)
  ├── ship (location_type='ship', location_id=ship.id)
  └── alliance_storage (location_type='alliance_storage', location_id=alliance.id)
```

---

## 15. Actions Requiring Transactions / Locking

The following actions must execute in a Postgres transaction with appropriate row-level locks to prevent race conditions:

| Action | Tables locked | Lock type | Notes |
|--------|---------------|-----------|-------|
| Colony claim | `colonies` (by body_id) | SELECT FOR UPDATE | Check body unclaimed before insert |
| System anchor claim | `system_ownership` (by system_id) | SELECT FOR UPDATE | Check system unowned before insert |
| Bid placement | `auctions` (by id) | SELECT FOR UPDATE | Check bid > current_high_bid; update escrow |
| Market order fill | `market_listings` (by id) | SELECT FOR UPDATE | Deduct quantity; transfer credits; update status |
| Tax collection | `players` (by id) | SELECT FOR UPDATE | Calculate yield; update credits + last_tax_collected_at |
| Alliance credit grant | `alliance_members` (by id) | SELECT FOR UPDATE | Debit/credit alliance_credits |
| Alliance storage withdrawal | `resource_inventory` + `alliance_members` | SELECT FOR UPDATE | Check credits, check stock, debit both atomically |
| Premium item consumption | `premium_entitlements` (by id) | SELECT FOR UPDATE | Check not already consumed; mark consumed; apply effect |
| Ship cargo load/unload | `resource_inventory` (colony + ship rows) | SELECT FOR UPDATE | Check storage caps, transfer quantities atomically |
