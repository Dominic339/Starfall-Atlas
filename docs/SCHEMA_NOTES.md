# Starfall Atlas — Schema Notes

> Version: 0.2 (Alpha Design)
> Last updated: 2026-03-17

This document describes the Supabase/Postgres data model for Starfall Atlas. It is a design reference for writing migrations. All entity names and column names here should be used consistently across migrations, application code, and type definitions.

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Enums](#2-enums)
3. [Players](#3-players)
4. [World: Discoveries and Surveys](#4-world-discoveries-and-surveys)
5. [Colonies and Structures](#5-colonies-and-structures)
6. [System Governance](#6-system-governance)
7. [Hyperspace Gates](#7-hyperspace-gates)
8. [Travel Jobs](#8-travel-jobs)
9. [Hyperspace Lanes](#9-hyperspace-lanes)
10. [Resources and Inventories](#10-resources-and-inventories)
11. [Markets](#11-markets)
12. [Auctions](#12-auctions)
13. [Alliances](#13-alliances)
14. [Premium Entitlements](#14-premium-entitlements)
15. [Logs](#15-logs)
16. [Relationship Summary](#16-relationship-summary)
17. [Actions Requiring Transactions / Locking](#17-actions-requiring-transactions--locking)

---

## 1. Conventions

- All tables use `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- All tables have `created_at TIMESTAMPTZ DEFAULT NOW()` and `updated_at TIMESTAMPTZ DEFAULT NOW()`.
- Foreign keys reference `players(id)` as `player_id`, or more specific names where clarity demands it (e.g., `owner_id`, `steward_id`).
- `system_id` and `body_id` are string identifiers derived from the star catalog (not UUIDs) — they are stable cross-environment references into the deterministic world. Format: `system_id` is the HYG catalog ID as a string; `body_id` is `{system_id}:{body_index}`.
- Timestamps used for job completion use the pattern `{action}_at` (e.g., `arrive_at`, `complete_at`).
- Soft-deletes are not used. Rows are deleted or marked with a status enum.

### Ownership model glossary

To prevent confusion in code reviews and migrations, these terms have precise meanings:

| Term | Table | Description |
|------|-------|-------------|
| Discovery credit | `system_discoveries.is_first` | Permanent cosmetic record of who found a system first |
| Stewardship | `system_stewardship` | Early governance rights from first discovery; replaceable by majority control |
| Colony ownership | `colonies.owner_id` | Player who owns a specific body's settlement |
| Majority control | `system_majority_control` | Governance rights based on >50% system influence |
| Gate control | `hyperspace_gates.owner_id` | Who built and manages the system's gate |
| Infrastructure control | `hyperspace_gates.status` | Whether a gate is active, neutral, or inactive |

---

## 2. Enums

```sql
-- Job and action status
CREATE TYPE job_status AS ENUM ('pending', 'complete', 'cancelled', 'failed');

-- Lane access level
CREATE TYPE lane_access AS ENUM ('public', 'alliance_only', 'private');

-- Alliance membership tier
CREATE TYPE alliance_role AS ENUM ('founder', 'officer', 'member');

-- Structure type (colony-level structures only; hyperspace_gate is a system-level entity)
CREATE TYPE structure_type AS ENUM (
  'extractor',
  'warehouse',
  'shipyard',         -- post-alpha only
  'trade_hub',
  'relay_station'
);

-- Colony lifecycle status
CREATE TYPE colony_status AS ENUM (
  'active',       -- operating normally
  'abandoned',    -- owner inactive; no production or influence; within resolution window
  'collapsed'     -- resolution window expired; body is claimable again
);

-- Hyperspace gate status
CREATE TYPE gate_status AS ENUM (
  'inactive',     -- under construction
  'active',       -- operational; governance holder manages policy
  'neutral'       -- governance changed; public access; no active owner
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
  'stewardship_registered',     -- first discoverer becomes steward
  'stewardship_transferred',    -- stewardship sold/transferred
  'majority_control_gained',    -- player/alliance crosses influence threshold
  'majority_control_lost',      -- majority controller falls below threshold
  'colony_founded',
  'colony_abandoned',           -- player went inactive; colony enters abandoned state
  'colony_collapsed',           -- resolution window expired; body is claimable
  'colony_reactivated',         -- player returned during resolution window
  'colony_sold',
  'system_sold',                -- stewardship auctioned/transferred
  'gate_built',
  'gate_neutralized',           -- gate control reset on governance transfer
  'gate_reclaimed',             -- new governance holder reactivated a neutral gate
  'lane_built',
  'alliance_formed',
  'alliance_dissolved'
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
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id              UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  handle               TEXT NOT NULL UNIQUE,             -- display name, immutable after set
  credits              BIGINT NOT NULL DEFAULT 0,        -- in-game currency (Credits)
  colony_slots         SMALLINT NOT NULL DEFAULT 1,      -- max active colonies allowed
  colony_permits_used  SMALLINT NOT NULL DEFAULT 0,      -- premium Colony Permit usage (max 2)
  first_colony_placed  BOOLEAN NOT NULL DEFAULT FALSE,   -- gates pre-colony free travel
  last_active_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- `credits` is managed server-side only. Never expose a client write path.
- `colony_slots` counts only `active` colonies. Abandoned or collapsed colonies do not consume a slot.
- `first_colony_placed` is set to TRUE when the player's first colony claim resolves.

---

## 4. World: Discoveries and Surveys

### `system_discoveries`

Records which players have discovered which systems.

```sql
CREATE TABLE system_discoveries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id     TEXT NOT NULL,
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  is_first      BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE for the very first discoverer (permanent)
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (system_id, player_id)
);
```

**Notes**:
- `is_first = TRUE` grants stewardship: when this row is inserted with `is_first = TRUE`, a row is also inserted into `system_stewardship` (done atomically in the same transaction).
- `is_first` is permanent and cannot be transferred.

### `survey_jobs`

Tracks in-progress and completed surveys of system bodies.

```sql
CREATE TABLE survey_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
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
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id         TEXT NOT NULL,
  body_id           TEXT NOT NULL UNIQUE,
  revealed_by       UUID NOT NULL REFERENCES players(id),  -- first surveyor
  resource_nodes    JSONB NOT NULL DEFAULT '[]',
  -- resource_nodes: [{ type: string, quantity: integer, is_rare: boolean }]
  has_deep_nodes    BOOLEAN NOT NULL DEFAULT FALSE,
  deep_nodes        JSONB NOT NULL DEFAULT '[]',
  first_surveyed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 5. Colonies and Structures

### `colonies`

```sql
CREATE TABLE colonies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID NOT NULL REFERENCES players(id),
  system_id             TEXT NOT NULL,
  body_id               TEXT NOT NULL UNIQUE,       -- one colony per body at a time
  status                colony_status NOT NULL DEFAULT 'active',
  population_tier       SMALLINT NOT NULL DEFAULT 1 CHECK (population_tier BETWEEN 1 AND 10),
  next_growth_at        TIMESTAMPTZ,               -- NULL until growth conditions met
  last_tax_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  storage_cap           INTEGER NOT NULL DEFAULT 1000,
  abandoned_at          TIMESTAMPTZ,               -- set when status → 'abandoned'
  collapsed_at          TIMESTAMPTZ,               -- set when status → 'collapsed'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- `UNIQUE (body_id)` prevents simultaneous claims. When a colony collapses, this row's status is set to `'collapsed'` but the row is retained as a historical record. A new claim creates a new row.
- Abandoned/collapsed colonies count **zero** system influence.
- Abandoned/collapsed colonies do **not** consume a colony slot.
- Collapsed colony bodies are claimable: a new claim inserts a fresh `colonies` row (the old collapsed row remains as history).

### `structures`

```sql
CREATE TABLE structures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colony_id             UUID NOT NULL REFERENCES colonies(id) ON DELETE CASCADE,
  owner_id              UUID NOT NULL REFERENCES players(id),
  type                  structure_type NOT NULL,
  tier                  SMALLINT NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 5),
  is_active             BOOLEAN NOT NULL DEFAULT FALSE,  -- FALSE until construction complete or if colony abandoned/collapsed
  built_at              TIMESTAMPTZ,
  last_extract_at       TIMESTAMPTZ,                     -- Extractors: last extraction tick
  extract_resource_type TEXT,                            -- Extractors: which resource
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- When a colony's status changes to `abandoned` or `collapsed`, all associated structures have `is_active` set to FALSE.
- Structures on collapsed bodies become ruins and remain in the table. A new owner may salvage (repair at resource cost) or demolish them.

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

## 6. System Governance

These three tables together represent the full governance model. They are distinct and must not be conflated.

### `system_stewardship`

Tracks first-discoverer stewardship and early governance rights.

```sql
CREATE TABLE system_stewardship (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id        TEXT NOT NULL UNIQUE,
  steward_id       UUID NOT NULL REFERENCES players(id),
  -- How stewardship was most recently acquired
  method           TEXT NOT NULL DEFAULT 'discovery'
                     CHECK (method IN ('discovery', 'transfer', 'auction')),
  -- Whether the steward currently holds governance.
  -- Set to FALSE when majority_control is claimed by someone else.
  has_governance   BOOLEAN NOT NULL DEFAULT TRUE,
  -- Royalty rate set by steward (effective only when has_governance = TRUE)
  royalty_rate     SMALLINT NOT NULL DEFAULT 0
                     CHECK (royalty_rate BETWEEN 0 AND 20),
  acquired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- A row exists for every system that has been discovered (inserted atomically with the `is_first` discovery record).
- `has_governance = TRUE` means the steward is the active governance holder.
- `has_governance = FALSE` means a majority controller has taken over governance (see `system_majority_control`).
- Stewardship can be transferred (method = 'transfer' or 'auction'). This changes `steward_id` and resets `has_governance = TRUE` only if there is no active majority controller.

### `system_majority_control`

Tracks which player or alliance holds majority control once the development threshold is met.

```sql
CREATE TABLE system_majority_control (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id         TEXT NOT NULL UNIQUE,
  controller_id     UUID NOT NULL REFERENCES players(id),  -- individual majority holder
  -- Non-NULL when the majority is held collectively by an alliance
  alliance_id       UUID REFERENCES alliances(id),
  -- The influence share (0.0–1.0) at the time control was last confirmed
  influence_share   NUMERIC(5, 4) NOT NULL
                      CHECK (influence_share > 0.5 AND influence_share <= 1.0),
  -- Whether control is currently confirmed (FALSE = contested, pending re-check)
  is_confirmed      BOOLEAN NOT NULL DEFAULT TRUE,
  control_since     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- A row is inserted when majority control is first claimed via a server action.
- When inserted, `system_stewardship.has_governance` is set to FALSE for the same `system_id`.
- When the majority controller's influence drops below 50%, `is_confirmed = FALSE`. Governance reverts to steward until re-confirmed or a new majority forms.
- If no majority exists and `system_stewardship.has_governance = FALSE`, the system is temporarily ungoverned.

### `system_influence_cache`

Denormalized cache of per-player influence scores per system. Recomputed on relevant events.

```sql
CREATE TABLE system_influence_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id    TEXT NOT NULL,
  player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  influence    INTEGER NOT NULL DEFAULT 0 CHECK (influence >= 0),
  colony_count SMALLINT NOT NULL DEFAULT 0,   -- active colonies contributing influence
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (system_id, player_id)
);
```

**Notes**:
- Updated (upserted) whenever a colony in the system changes tier, is built, abandoned, or collapsed.
- Updated when structures are added or removed in the system.
- Updated when a gate is built (owner's influence gets the gate bonus).
- The cache is used for fast majority-control threshold checks. The authoritative formula is in application code (see `src/lib/game/influence.ts` — to be created in Phase 5).

---

## 7. Hyperspace Gates

Gates are system-level infrastructure. There is at most one gate per system.

### `hyperspace_gates`

```sql
CREATE TABLE hyperspace_gates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id       TEXT NOT NULL UNIQUE,         -- one gate per system
  owner_id        UUID NOT NULL REFERENCES players(id),  -- player who built/last reclaimed it
  status          gate_status NOT NULL DEFAULT 'inactive',
  tier            SMALLINT NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 5),
  built_at        TIMESTAMPTZ,                  -- set when status → 'active'
  neutralized_at  TIMESTAMPTZ,                  -- set when governance changed and gate became neutral
  reclaimed_at    TIMESTAMPTZ,                  -- set when neutral gate is reactivated by new governance
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- `owner_id` is the player who controls access policy when `status = 'active'`.
- When governance transfers, `status` is set to `'neutral'` and `neutralized_at` is recorded. `owner_id` is NOT cleared — it reflects who last actively owned it, for audit purposes.
- A neutral gate is traversable by all players until the new governance holder reclaims it.
- Building a gate requires the player to be the current governance holder in `system_stewardship` or `system_majority_control`.

### `gate_construction_jobs`

```sql
CREATE TABLE gate_construction_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id       UUID NOT NULL REFERENCES hyperspace_gates(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  complete_at   TIMESTAMPTZ NOT NULL,
  status        job_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 8. Travel Jobs

### `ships`

```sql
CREATE TABLE ships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  speed_ly_per_hr     NUMERIC(8,4) NOT NULL DEFAULT 1.0 CHECK (speed_ly_per_hr > 0),
  cargo_cap           INTEGER NOT NULL DEFAULT 100 CHECK (cargo_cap > 0),
  current_system_id   TEXT,       -- NULL while in transit
  current_body_id     TEXT,       -- NULL if not landed on a body
  skin_entitlement_id UUID,       -- FK to premium_entitlements (cosmetic)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `travel_jobs`

```sql
CREATE TABLE travel_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_id          UUID NOT NULL REFERENCES ships(id),
  player_id        UUID NOT NULL REFERENCES players(id),
  from_system_id   TEXT NOT NULL,
  to_system_id     TEXT NOT NULL,
  -- NULL for Unstable Warp Tunnel (premium item, no physical lane)
  lane_id          UUID REFERENCES hyperspace_lanes(id),
  depart_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arrive_at        TIMESTAMPTZ NOT NULL,
  transit_tax_paid BIGINT NOT NULL DEFAULT 0 CHECK (transit_tax_paid >= 0),
  status           job_status NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 9. Hyperspace Lanes

### `hyperspace_lanes`

```sql
CREATE TABLE hyperspace_lanes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES players(id),
  from_system_id   TEXT NOT NULL,
  to_system_id     TEXT NOT NULL,
  -- Gate IDs at each endpoint. NULL is allowed only for premium Stabilized Wormhole
  -- (which does not require a gate at the far endpoint).
  from_gate_id     UUID REFERENCES hyperspace_gates(id) ON DELETE SET NULL,
  to_gate_id       UUID REFERENCES hyperspace_gates(id) ON DELETE SET NULL,
  access_level     lane_access NOT NULL DEFAULT 'public',
  transit_tax_rate SMALLINT NOT NULL DEFAULT 0 CHECK (transit_tax_rate BETWEEN 0 AND 5),
  is_active        BOOLEAN NOT NULL DEFAULT FALSE,
  built_at         TIMESTAMPTZ,
  alliance_id      UUID,   -- FK to alliances(id) added after alliances table is created
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_system_id, to_system_id)
);
```

**Notes**:
- `from_gate_id` and `to_gate_id` reference the gates at each endpoint.
- A lane is considered traversable if both referenced gates are `active` or `neutral`.
- If a gate is demolished (future feature), the lane becomes inactive (`is_active = FALSE`).

### `lane_construction_jobs`

```sql
CREATE TABLE lane_construction_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_id       UUID NOT NULL REFERENCES hyperspace_lanes(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  complete_at   TIMESTAMPTZ NOT NULL,
  status        job_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 10. Resources and Inventories

### `resource_inventory`

A single unified inventory table for colonies, ships, and alliance storage.

```sql
CREATE TABLE resource_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_type TEXT NOT NULL CHECK (location_type IN ('colony', 'ship', 'alliance_storage')),
  location_id   UUID NOT NULL,
  resource_type TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_type, location_id, resource_type)
);
```

**Notes**:
- `quantity >= 0` prevents negative inventory at DB level.
- When a colony collapses, its resource_inventory rows are deleted (resources are lost).
- When a colony is abandoned (not yet collapsed), its inventory is retained.

---

## 11. Markets

### `market_listings`

```sql
CREATE TABLE market_listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id        TEXT NOT NULL,
  seller_id        UUID REFERENCES players(id),
  buyer_id         UUID REFERENCES players(id),
  side             order_side NOT NULL,
  resource_type    TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  quantity_filled  INTEGER NOT NULL DEFAULT 0,
  price_per_unit   BIGINT NOT NULL CHECK (price_per_unit > 0),
  listing_fee_paid BIGINT NOT NULL DEFAULT 0,
  escrow_held      BIGINT NOT NULL DEFAULT 0,
  system_id        TEXT NOT NULL,
  status           order_status NOT NULL DEFAULT 'open',
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  price_per_unit  BIGINT NOT NULL CHECK (price_per_unit > 0),
  total_credits   BIGINT NOT NULL CHECK (total_credits > 0),
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `claim_tickets`

Issued to buyers after a trade matches.

```sql
CREATE TABLE claim_tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id      UUID NOT NULL REFERENCES market_trades(id),
  buyer_id      UUID NOT NULL REFERENCES players(id),
  system_id     TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  claimed       BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `universal_exchange_purchases`

Log of Emergency Universal Exchange (EUX) transactions (see GAME_RULES.md §19).

```sql
CREATE TABLE universal_exchange_purchases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('iron', 'carbon', 'ice')),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  credits_paid  BIGINT NOT NULL CHECK (credits_paid > 0),
  -- Colony where goods were delivered
  colony_id     UUID NOT NULL REFERENCES colonies(id),
  purchased_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- Records are immutable (no UPDATE). Credits are burned at purchase time.
- Daily purchase limits are enforced in application code (sum of quantity by player/day).

---

## 12. Auctions

### `auctions`

```sql
CREATE TABLE auctions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        UUID NOT NULL REFERENCES players(id),
  -- 'colony'      = a specific colony (with or without structures)
  -- 'stewardship' = system stewardship rights (governance only; discovery credit NOT transferred)
  -- 'ship'        = a ship (post-alpha)
  -- 'item'        = a rare item
  item_type        TEXT NOT NULL CHECK (item_type IN ('colony', 'stewardship', 'ship', 'item')),
  item_id          TEXT NOT NULL,
  min_bid          BIGINT NOT NULL DEFAULT 0 CHECK (min_bid >= 0),
  current_high_bid BIGINT NOT NULL DEFAULT 0,
  high_bidder_id   UUID REFERENCES players(id),
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  status           auction_status NOT NULL DEFAULT 'active',
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- `item_type = 'stewardship'` and `item_id = system_id`: transfers `system_stewardship.steward_id` on resolution. Does NOT transfer the original `is_first` discovery credit in `system_discoveries`.

### `auction_bids`

```sql
CREATE TABLE auction_bids (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  UUID NOT NULL REFERENCES auctions(id),
  bidder_id   UUID NOT NULL REFERENCES players(id),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  escrow_held BOOLEAN NOT NULL DEFAULT TRUE,
  placed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 13. Alliances

### `alliances`

```sql
CREATE TABLE alliances (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 3 AND 64),
  founder_id            UUID NOT NULL REFERENCES players(id),
  member_count          SMALLINT NOT NULL DEFAULT 1 CHECK (member_count BETWEEN 1 AND 100),
  emblem_entitlement_id UUID,   -- FK to premium_entitlements (cosmetic)
  dissolved_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `alliance_members`

```sql
CREATE TABLE alliance_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_id      UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  player_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role             alliance_role NOT NULL DEFAULT 'member',
  alliance_credits BIGINT NOT NULL DEFAULT 0 CHECK (alliance_credits >= 0),
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id)  -- one alliance per player
);
```

### `alliance_goals`

```sql
CREATE TABLE alliance_goals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_id      UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  created_by       UUID NOT NULL REFERENCES players(id),
  title            TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 128),
  resource_type    TEXT NOT NULL,
  quantity_target  INTEGER NOT NULL CHECK (quantity_target > 0),
  quantity_filled  INTEGER NOT NULL DEFAULT 0,
  credit_reward    BIGINT NOT NULL DEFAULT 0,
  deadline_at      TIMESTAMPTZ NOT NULL,
  completed_at     TIMESTAMPTZ,
  expired          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `alliance_goal_contributions`

```sql
CREATE TABLE alliance_goal_contributions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id        UUID NOT NULL REFERENCES alliance_goals(id) ON DELETE CASCADE,
  player_id      UUID NOT NULL REFERENCES players(id),
  resource_type  TEXT NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  contributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 14. Premium Entitlements

### `premium_entitlements`

```sql
CREATE TABLE premium_entitlements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_type     premium_item_type NOT NULL,
  item_config   JSONB NOT NULL DEFAULT '{}',
  -- item_config examples:
  --   ship_skin:           { "skin_id": "nebula_blue" }
  --   vanity_name_tag:     { "system_id": "12345", "label": "New Hope" }
  --   colony_banner:       { "colony_id": "uuid", "banner_id": "flag_v2" }
  --   unstable_warp_tunnel: {}  (target chosen at use time)
  --   stabilized_wormhole: { "from_system_id": "...", "to_system_id": "..." }
  consumed      BOOLEAN NOT NULL DEFAULT FALSE,
  consumed_at   TIMESTAMPTZ,
  purchase_ref  TEXT,   -- payment provider transaction ID
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 15. Logs

### `world_events`

Append-only log of major world events.

```sql
CREATE TABLE world_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  world_event_type NOT NULL,
  player_id   UUID REFERENCES players(id) ON DELETE SET NULL,
  system_id   TEXT,
  body_id     TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes**:
- Rows are never updated. The log is append-only.
- `metadata` holds event-specific details. Examples:
  - `majority_control_gained`: `{ "controller_id": "...", "alliance_id": null, "influence_share": 0.65 }`
  - `colony_abandoned`: `{ "owner_id": "...", "collapse_deadline": "..." }`
  - `gate_neutralized`: `{ "previous_owner_id": "...", "reason": "governance_transfer" }`

---

## 16. Relationship Summary

```
players
  ├── ships (owner_id)
  ├── colonies (owner_id)
  ├── system_stewardship (steward_id)
  ├── system_majority_control (controller_id)
  ├── system_influence_cache (player_id)
  ├── system_discoveries (player_id)
  ├── survey_jobs (player_id)
  ├── travel_jobs (player_id)
  ├── hyperspace_gates (owner_id)
  ├── hyperspace_lanes (owner_id)
  ├── market_listings (seller_id / buyer_id)
  ├── auctions (seller_id)
  ├── auction_bids (bidder_id)
  ├── alliance_members (player_id) → alliances
  └── premium_entitlements (player_id)

systems (logical, not a DB table — derived from star catalog)
  ├── system_stewardship      (governance: early/default)
  ├── system_majority_control (governance: development threshold)
  ├── system_influence_cache  (denormalized influence scores)
  ├── hyperspace_gates        (one gate per system)
  └── colonies                (multiple per system, one per body)

colonies
  ├── structures (colony_id)
  ├── construction_jobs → structures
  └── resource_inventory (location_type='colony', location_id=colony.id)

alliances
  ├── alliance_members (alliance_id)
  ├── alliance_goals (alliance_id)
  └── resource_inventory (location_type='alliance_storage', location_id=alliance.id)

hyperspace_gates
  └── hyperspace_lanes (from_gate_id / to_gate_id)
```

---

## 17. Actions Requiring Transactions / Locking

| Action | Tables locked | Lock type | Notes |
|--------|---------------|-----------|-------|
| Colony claim | `colonies` (by body_id) | SELECT FOR UPDATE | Check body unclaimed (status != 'active'); insert new row |
| Stewardship registration | `system_stewardship` (by system_id) | SELECT FOR UPDATE | Atomic with `is_first` discovery insert |
| Majority control claim | `system_majority_control`, `system_stewardship`, `system_influence_cache` | SELECT FOR UPDATE | Verify >50% influence; update steward governance flag |
| Colony abandonment | `colonies`, `structures`, `system_influence_cache` | SELECT FOR UPDATE | Set status = 'abandoned'; deactivate structures; recompute influence |
| Colony collapse | `colonies`, `structures`, `resource_inventory`, `system_influence_cache` | SELECT FOR UPDATE | Set status = 'collapsed'; clear inventory; update influence |
| Gate construction | `hyperspace_gates` (by system_id) | SELECT FOR UPDATE | Verify no existing gate; check governance; insert row |
| Gate reclaim | `hyperspace_gates`, `system_stewardship` / `system_majority_control` | SELECT FOR UPDATE | Verify neutral status; verify caller is governance holder |
| Bid placement | `auctions` (by id) | SELECT FOR UPDATE | Check bid > current_high_bid; update escrow |
| Market order fill | `market_listings` (by id) | SELECT FOR UPDATE | Deduct quantity; transfer credits; update status |
| Tax collection | `players` (by id) | SELECT FOR UPDATE | Calculate yield; update credits + last_tax_collected_at |
| EUX purchase | `players` (by id), `resource_inventory` | SELECT FOR UPDATE | Check credit balance; check daily limit; burn credits; deliver resources |
| Alliance credit grant | `alliance_members` (by id) | SELECT FOR UPDATE | Debit/credit alliance_credits |
| Alliance storage withdrawal | `resource_inventory` + `alliance_members` | SELECT FOR UPDATE | Check credits, check stock, debit both atomically |
| Premium item consumption | `premium_entitlements` (by id) | SELECT FOR UPDATE | Check not consumed; mark consumed; apply effect |
| Ship cargo load/unload | `resource_inventory` (colony + ship rows) | SELECT FOR UPDATE | Check storage caps; transfer quantities atomically |
| Influence cache update | `system_influence_cache` | UPSERT | After any colony tier change, structure change, or gate event |
