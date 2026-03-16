# Starfall Atlas — Architecture

> Version: 0.1 (Alpha Design)
> Last updated: 2026-03-16

This document describes the technical architecture for Starfall Atlas. It is intended as the authoritative reference for how the application is structured, how data flows, and how game-critical actions are handled safely.

---

## Table of Contents

1. [Stack Overview](#1-stack-overview)
2. [Data Philosophy: Generated vs Persisted](#2-data-philosophy-generated-vs-persisted)
3. [Directory Structure](#3-directory-structure)
4. [Server-Authoritative Design](#4-server-authoritative-design)
5. [Timestamp-Based Travel and Jobs](#5-timestamp-based-travel-and-jobs)
6. [API Layer](#6-api-layer)
7. [Concurrency and Contested Actions](#7-concurrency-and-contested-actions)
8. [Authentication](#8-authentication)
9. [Hosting and Cost Strategy](#9-hosting-and-cost-strategy)
10. [Supabase Usage Patterns](#10-supabase-usage-patterns)
11. [Real-Time and Presence](#11-real-time-and-presence)
12. [Client Architecture](#12-client-architecture)

---

## 1. Stack Overview

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Validation | Zod |
| Database | Supabase (Postgres) |
| Auth | Supabase Auth |
| Hosting | Vercel (Next.js) + Supabase (managed Postgres + Auth) |
| Storage | Supabase Storage (for future asset uploads) |

No additional backend service exists in alpha. All game logic runs in Next.js **Route Handlers** (API routes) or **Server Actions**. This keeps the deployment surface minimal.

---

## 2. Data Philosophy: Generated vs Persisted

This distinction is fundamental to the design and must be respected across all features.

### 2.1 Deterministic Generated Data (never stored)

These values are computed on-demand from a seed (the star catalog) and are always the same for every player, every call, every environment:

- Star positions, names, spectral types, distances
- System body composition (planet types, sizes, moons)
- Base resource node types and quantities per body
- Lane range limits per system (based on star type)
- Which body is a system's "anchor point"

**Rule**: Never write generated data to the database. Always recompute it from the seed. This eliminates entire classes of migration bugs and sync issues, and keeps the database small.

### 2.2 Persisted Game State (always in Supabase)

These values represent irreversible or player-driven changes:

- Player accounts, wallets, inventory
- Discoveries (which systems a player has found)
- Survey results (revealed resource profiles)
- Colony claims and ownership
- Structures (type, tier, build timestamps)
- Travel jobs (depart/arrive timestamps)
- Market listings, bids, auctions
- Hyperspace lanes (constructed, ownership, access level)
- Resource inventories (colonies, ships, alliance storage)
- Alliance memberships, credits, goals
- Premium entitlements
- World changes log

**Rule**: All game state changes must go through server-side route handlers or server actions. Clients never write to Supabase directly for game state.

---

## 3. Directory Structure

```
starfall-atlas/
├── src/
│   ├── app/
│   │   ├── (game)/             # Game UI routes (authenticated)
│   │   │   ├── galaxy/         # Galaxy map view
│   │   │   ├── system/[id]/    # System detail view
│   │   │   ├── colony/[id]/    # Colony management view
│   │   │   ├── market/[region]/ # Regional market view
│   │   │   ├── alliance/       # Alliance dashboard
│   │   │   └── shop/           # Premium shop
│   │   ├── (auth)/             # Login / register flows
│   │   ├── api/
│   │   │   ├── game/           # Game action route handlers
│   │   │   │   ├── travel/     # POST /api/game/travel
│   │   │   │   ├── claim/      # POST /api/game/claim
│   │   │   │   ├── survey/     # POST /api/game/survey
│   │   │   │   ├── lane/       # POST /api/game/lane
│   │   │   │   ├── market/     # POST /api/game/market
│   │   │   │   ├── auction/    # POST /api/game/auction
│   │   │   │   └── colony/     # POST /api/game/colony
│   │   │   └── webhook/        # External webhooks (payment, etc.)
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts       # Browser Supabase client
│   │   │   └── server.ts       # Server-side Supabase client (cookies)
│   │   ├── galaxy/
│   │   │   ├── seed.ts         # Deterministic world generation from star data
│   │   │   ├── systems.ts      # System and body accessors
│   │   │   └── distance.ts     # Travel distance calculations
│   │   ├── game/
│   │   │   ├── travel.ts       # Travel duration, route validation
│   │   │   ├── claims.ts       # Claim resolution logic
│   │   │   ├── taxes.ts        # Tax calculation
│   │   │   ├── lanes.ts        # Lane construction, access checks
│   │   │   ├── market.ts       # Market matching logic
│   │   │   └── auctions.ts     # Auction resolution
│   │   └── utils/
│   │       ├── time.ts         # Timestamp helpers
│   │       └── validate.ts     # Zod schemas for API inputs
│   └── types/
│       └── game.ts             # TypeScript types for game entities
├── docs/
│   ├── GAME_RULES.md
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── SCHEMA_NOTES.md
│   └── CLAUDE_WORKFLOW.md
├── supabase/
│   └── migrations/             # SQL migration files
└── README.md
```

---

## 4. Server-Authoritative Design

All **critical gameplay actions** must be processed server-side. The client is treated as untrusted for any state-changing operation.

### What counts as a critical action?

- Submitting travel (records depart/arrive timestamps)
- Resolving arrival (triggers downstream effects)
- Claiming a body (requires contention check)
- Building structures (deducts resources, starts timer)
- Collecting taxes (credits transfer)
- Posting/filling market orders (credits/resource transfer)
- Placing/winning bids (escrow management)
- Building hyperspace lanes (resource cost + timer)
- Withdrawing from alliance ship storage (Alliance Credits deduction)

### Pattern for server actions

Every critical action handler must:

1. **Authenticate**: Verify the session server-side using the Supabase server client. Reject unauthenticated requests with 401.
2. **Validate input**: Parse and validate the request body with a Zod schema. Reject invalid input with 400.
3. **Load and verify state**: Read the current game state from Supabase. Verify all preconditions (e.g., ship is present, target is unclaimed, player has sufficient resources).
4. **Execute within a transaction**: Use a Postgres transaction (via `supabase.rpc()` calling a PL/pgSQL function, or a series of operations wrapped appropriately) for any action touching multiple rows.
5. **Return the result**: Return updated state (or a minimal confirmation) to the client. Never trust the client to know what changed.

---

## 5. Timestamp-Based Travel and Jobs

The game avoids real-time simulation. Instead, all long-running operations use a **start + complete timestamp** pattern.

### Job lifecycle

```
Player submits action
        │
        ▼
Server validates preconditions
        │
        ▼
Server inserts row with:
  started_at  = NOW()
  complete_at = NOW() + duration
  status      = 'pending'
        │
        ▼
Client polls or checks on page load
        │
        ▼
If NOW() >= complete_at:
  Player triggers "resolve" action
        │
        ▼
Server resolves: applies outcome, updates status = 'complete'
```

### Key tables using this pattern

- `travel_jobs`: `depart_at`, `arrive_at`, ship transit
- `construction_jobs`: `started_at`, `complete_at`, building structures
- `survey_jobs`: `started_at`, `complete_at`, surveying bodies
- `colony_growth_events`: `next_growth_at`, next population tick

### No background workers in alpha

In alpha, the game has **no background cron jobs**. Outcomes are resolved lazily when players next interact with the relevant entity. This avoids the cost of serverless cron or background workers.

Tax accumulation is calculated on-demand: when a player views or collects taxes, the server reads `last_tax_collected_at` and computes the accumulated yield, capped at 24 hours.

---

## 6. API Layer

All game actions go through `POST /api/game/<action>` Route Handlers. They follow REST conventions but use POST for all state changes (to prevent caching/replay issues).

### Request/response pattern

```typescript
// Input always validated with Zod
const schema = z.object({
  shipId: z.string().uuid(),
  targetSystemId: z.string(),
})

export async function POST(req: Request) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error }, { status: 400 })

  // Game logic here
}
```

### No direct Supabase client writes from browser

The browser-side Supabase client is used **only** for:
- Reading public/shared data (galaxy map, market listings, discovery log)
- Auth session management

The browser never calls Supabase RPC functions or writes to game state tables directly. All writes go through the Next.js API layer where authorization and validation are enforced.

---

## 7. Concurrency and Contested Actions

The most sensitive concurrency scenarios are:

### 7.1 Colony Claims

Two players may complete a claim deployment at the same time. Resolution:

1. The claim endpoint executes a Postgres transaction with a `SELECT ... FOR UPDATE` lock on the target body row.
2. The first transaction to acquire the lock checks if the body is still unclaimed.
3. If unclaimed: completes the claim, commits, returns success.
4. The second transaction acquires the lock, finds the body claimed, rolls back, returns a "contested" error.
5. The loser is notified and refunded.

### 7.2 Auction Bids

1. Bids are inserted in a transaction that locks the auction row.
2. If the bid is higher than the current high bid: the previous high bidder's escrow is released and the new bid is recorded as high bid.
3. Anti-snipe extension is applied atomically in the same transaction.

### 7.3 Market Order Matching

1. When a new order (buy or sell) is posted, the server checks for matching orders in the same transaction.
2. If a match exists: resources and credits transfer atomically.
3. Partial fills are supported: a buy order for 100 units may match against multiple sell orders.

### 7.4 General Principle

Any action that reads a row and conditionally writes based on that row's value must do so inside a Postgres transaction with appropriate locking. PL/pgSQL functions called via `supabase.rpc()` are the preferred mechanism for complex multi-row operations.

---

## 8. Authentication

- Authentication is handled by **Supabase Auth**.
- The `@supabase/ssr` package is used to manage sessions via cookies in the Next.js App Router.
- Route protection is enforced in middleware: unauthenticated requests to `(game)` routes are redirected to login.
- Server-side Supabase clients are created per-request using `createServerClient()` from `@supabase/ssr`, passing the current cookies.
- Row-Level Security (RLS) in Supabase is enabled on all game tables as a defense-in-depth measure, but the primary authorization layer is the Next.js API route (which uses the service-role key for game state writes after manual authorization checks).

---

## 9. Hosting and Cost Strategy

The primary cost levers are: database size, compute (serverless function invocations), and real-time connections.

### Keeping costs low

| Strategy | Detail |
|----------|--------|
| Generated world is never stored | The star catalog is shipped as a static JSON/binary asset or hardcoded constants. No Supabase rows for the galaxy baseline. |
| No background workers in alpha | All job resolution is lazy/on-demand. No cron, no queue, no workers. |
| No live ship simulation | No per-second writes. Ships only touch the database when a job starts or resolves. |
| RLS + server-side auth | No need for a separate API gateway. |
| Minimal real-time subscriptions | Supabase Realtime is used sparingly — only for the world changes feed and market order matching notifications. |
| Static assets on CDN | Public galaxy data files served via Vercel Edge. |
| Vercel hobby/pro tier | Fits alpha scale. Scale up only when MAU warrants it. |

---

## 10. Supabase Usage Patterns

### Client types

```typescript
// src/lib/supabase/server.ts — for Route Handlers and Server Components
import { createServerClient } from '@supabase/ssr'

// src/lib/supabase/client.ts — for Client Components (read-only game data)
import { createBrowserClient } from '@supabase/ssr'
```

### RLS Policy approach

- All game state tables have RLS enabled.
- Players can SELECT their own rows (using `auth.uid()`).
- Public-read tables (market listings, discovery log, lane map) allow SELECT for all authenticated users.
- INSERT/UPDATE/DELETE on game state tables is **denied by RLS** for the anon and authenticated roles — only the service role (used by the Next.js API routes) may write game state.
- This means a player who bypasses the UI and directly calls the Supabase API cannot modify game state.

### Migrations

- All schema changes are captured in `supabase/migrations/` as numbered SQL files.
- Migrations are applied via the Supabase CLI (`supabase db push` or `supabase migration up`).
- Never modify production schema directly in the Supabase dashboard.

---

## 11. Real-Time and Presence

Supabase Realtime is used conservatively:

| Channel | Used for |
|---------|---------|
| `world-changes` | Broadcast of new discoveries, new colonies, system sales |
| `market:{region_id}` | Broadcast when a new listing is posted or a match occurs |
| `auction:{auction_id}` | Broadcast when a new bid is placed |

Presence (live user online status) is **not used** in alpha. Activity is shown via `last_active_at` timestamps on player rows, not live connections.

---

## 12. Client Architecture

### State management

No global client state management library in alpha. Server Components fetch fresh data on each render. Client Components use React state for local UI state only.

### Map rendering

The galaxy map is a 2D canvas or SVG component rendered from the star catalog data. It is not a 3D scene. Stars are rendered as colored dots. Hyperspace lanes are rendered as lines. No real-time animation.

### Navigation

Next.js App Router with file-based routing. The `(game)` route group wraps all authenticated pages in a shared layout with navigation.

### Data fetching

- Server Components use the server Supabase client to fetch game state.
- Client Components that need fresh data use `fetch` against the Next.js API routes.
- No direct Supabase client queries from Client Components for game state.
