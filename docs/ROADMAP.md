# Starfall Atlas — Roadmap

> Version: 0.1 (Alpha Design)
> Last updated: 2026-03-16

This roadmap describes the planned implementation phases for Starfall Atlas. The goal is a fast alpha focused on the core economy and exploration loop, with no combat and no real-time simulation.

Each phase has a clear deliverable and exit criteria. Phases are sequential; later phases may be reprioritized based on playtest feedback.

---

## Phase 0 — Foundation (Current)

**Goal**: Establish a clean, buildable project with authoritative documentation and schema design before writing any gameplay code.

**Deliverables**:
- [x] Next.js + Supabase scaffold created
- [x] Tailwind CSS, Zod, and `@supabase/ssr` installed
- [ ] `docs/GAME_RULES.md` — authoritative game rules
- [ ] `docs/ARCHITECTURE.md` — system design
- [ ] `docs/SCHEMA_NOTES.md` — data model notes
- [ ] `docs/ROADMAP.md` — this file
- [ ] `docs/CLAUDE_WORKFLOW.md` — AI contributor workflow
- [ ] `README.md` — project overview and setup
- [ ] Supabase project created and linked
- [ ] Initial migration file structure in `supabase/migrations/`

**Exit criteria**: All docs are complete and internally consistent. The app builds and runs with `npm run dev`.

---

## Phase 1 — Schema and Migrations

**Goal**: Translate `SCHEMA_NOTES.md` into real, runnable Supabase migrations. No gameplay logic yet.

**Deliverables**:
- [ ] `supabase/migrations/001_players.sql` — player accounts, wallets
- [ ] `supabase/migrations/002_world.sql` — discoveries, survey results
- [ ] `supabase/migrations/003_colonies.sql` — colonies, structures, construction jobs
- [ ] `supabase/migrations/004_travel.sql` — travel jobs
- [ ] `supabase/migrations/005_lanes.sql` — hyperspace lanes, permissions
- [ ] `supabase/migrations/006_resources.sql` — inventories (colony, ship, alliance)
- [ ] `supabase/migrations/007_economy.sql` — market listings, auctions, bids
- [ ] `supabase/migrations/008_alliances.sql` — alliances, memberships, goals, credits
- [ ] `supabase/migrations/009_premium.sql` — premium entitlements
- [ ] `supabase/migrations/010_logs.sql` — world changes feed
- [ ] RLS policies for all tables
- [ ] Seed migration with Sol system seeded as the starting system

**Exit criteria**: `supabase db push` runs cleanly. All tables exist with correct columns, constraints, and RLS.

---

## Phase 2 — Star Catalog and World Generation

**Goal**: Load the real star catalog (HYG or similar) and implement the deterministic world generation layer.

**Deliverables**:
- [ ] Star catalog imported as a static asset (JSON or binary, not stored in Supabase)
- [ ] `src/lib/galaxy/seed.ts` — seeded generation of system bodies from star data
- [ ] `src/lib/galaxy/systems.ts` — accessors for star/body data
- [ ] `src/lib/galaxy/distance.ts` — light-year distance calculations between systems
- [ ] `src/lib/galaxy/resources.ts` — deterministic resource profiles per body
- [ ] Unit tests for generation functions (same seed always produces same output)
- [ ] Static galaxy map component (2D SVG or canvas, dots and labels only)

**Exit criteria**: The galaxy map renders from real star data. All generation functions have passing tests.

---

## Phase 3 — Auth and Player Setup

**Goal**: Players can register, log in, and are initialized in the game world at Sol.

**Deliverables**:
- [ ] Supabase Auth wired up with Next.js middleware route protection
- [ ] Register/login pages
- [ ] On first login: player row inserted with starting wallet (0 credits) and starter ship at Sol
- [ ] Player profile page (basic: handle, wallet balance, colonies owned)
- [ ] `src/lib/supabase/server.ts` and `client.ts` set up correctly

**Exit criteria**: A user can register, log in, see their profile, and their starter ship appears at Sol.

---

## Phase 4 — Discovery and Survey Actions

**Goal**: Players can discover star systems and survey bodies.

**Deliverables**:
- [ ] `POST /api/game/travel` — submit a travel job to an adjacent or reachable system
- [ ] Travel job resolution (lazy, on player return)
- [ ] `POST /api/game/discover` — mark a system as discovered by the player
- [ ] `POST /api/game/survey` — submit a survey job for a body
- [ ] Survey job resolution (lazy)
- [ ] Discovery log feed (shared, shows recent first-discoveries)
- [ ] System detail page: shows discovered bodies, survey status, resource profiles (if surveyed)

**Exit criteria**: A player can travel from Sol to an adjacent system, discover it, and survey a body to see its resource profile.

---

## Phase 5 — Claims and Colony Basics

**Goal**: Players can claim a body and establish a colony.

**Deliverables**:
- [ ] `POST /api/game/claim` — claim a body (with contention handling via DB transaction)
- [ ] First colony is free; subsequent colonies require resources
- [ ] Colony detail page: population tier, structures, tax status
- [ ] `POST /api/game/colony/collect-taxes` — collect accumulated taxes
- [ ] Tax calculation function (reads `last_tax_collected_at`, calculates yield, caps at 24h)
- [ ] Activity indicators on colony pages

**Exit criteria**: A player can claim a body, establish a colony, and collect their first tax income in Credits.

---

## Phase 6 — Structures and Resource Extraction

**Goal**: Players can build structures and generate resources.

**Deliverables**:
- [ ] `POST /api/game/colony/build` — queue a construction job for a structure
- [ ] Construction job resolution (lazy)
- [ ] Extractor produces resources on tick (lazy calculation, same pattern as taxes)
- [ ] Warehouse increases storage cap
- [ ] Resource inventory views for colonies and ships
- [ ] Resource transport (load/unload ship cargo via travel)

**Exit criteria**: A player can build an Extractor, accumulate resources, and transport them via ship.

---

## Phase 7 — Hyperspace Lanes

**Goal**: Players can build and manage hyperspace lanes.

**Deliverables**:
- [ ] `POST /api/game/lane/build` — queue lane construction job
- [ ] Lane access level settings (public/alliance/private)
- [ ] Transit tax settings (validated against cap)
- [ ] Pre-colony free travel rule enforced server-side
- [ ] Relay Station extends range (calculated in `src/lib/game/lanes.ts`)
- [ ] Lane network visible on galaxy map (ownership-colored lines)

**Exit criteria**: A player can build a lane, set a transit tax, and other players can travel it (paying the tax).

---

## Phase 8 — Regional Markets

**Goal**: Players can buy and sell resources in regional markets.

**Deliverables**:
- [ ] `POST /api/game/market/list` — post a sell listing or buy order
- [ ] Market order matching (atomic, in transaction)
- [ ] Claim ticket issued to buyer; physical pickup via ship travel
- [ ] 2% listing fee burned
- [ ] Market UI: listings table, order form, own orders management

**Exit criteria**: Two players can trade a resource via the regional market, with credits transferring and goods requiring physical pickup.

---

## Phase 9 — Auctions

**Goal**: Players can auction colony sites and system ownership.

**Deliverables**:
- [ ] `POST /api/game/auction/create` — start an auction
- [ ] `POST /api/game/auction/bid` — place a bid (escrow + anti-snipe)
- [ ] Auction resolution at `end_time` (lazy, triggered when any player views the auction after it ends)
- [ ] Ownership transfer on resolution
- [ ] Auction listing page (global auction board)

**Exit criteria**: A player can list a colony site for auction, another player can bid, and ownership transfers on resolution.

---

## Phase 10 — Alliances

**Goal**: Players can form trade alliances with shared storage and internal credits.

**Deliverables**:
- [ ] Alliance creation, invitation, and membership management
- [ ] Alliance Credits: earn via resource donation, spend via alliance ship withdrawal
- [ ] Alliance Ship Storage (shared inventory)
- [ ] Alliance Goals: Officers post goals, members contribute
- [ ] Alliance dashboard UI: roster, credits, storage, goals

**Exit criteria**: An alliance can be formed, resources donated, and goods withdrawn via Alliance Credits.

---

## Phase 11 — Premium Shop (Cosmetics)

**Goal**: The premium shop exists and sells cosmetic items. No pay-to-win items in this phase.

**Deliverables**:
- [ ] Premium shop page (client-side UI)
- [ ] Payment webhook handler (integrate with Stripe or similar)
- [ ] `premium_entitlements` table populated on successful purchase
- [ ] Ship skin applied to player's ship display
- [ ] Colony banner/flag displayed on colony pages
- [ ] Vanity system name tags

**Exit criteria**: A player can purchase a cosmetic item, it is recorded in `premium_entitlements`, and it appears in-game.

---

## Phase 12 — Premium Mobility Items

**Goal**: Add mobility and utility premium items, with anti-pay-to-win guardrails verified.

**Deliverables**:
- [ ] Unstable Warp Tunnel item (one-way, any discovered system, single use, consumes entitlement)
- [ ] Stabilized Wormhole item (persistent two-way lane between owned systems)
- [ ] Deep Survey Kit (reveals rare nodes; server verifies same node caps as basic survey)
- [ ] Colony Permit (+1 colony slot, max 2 per account)
- [ ] All items consumed server-side from `premium_entitlements`

**Exit criteria**: All four premium items work correctly. Anti-p2w guardrails pass code review.

---

## Phase 13 — Alpha Polish and Open Testing

**Goal**: Close gameplay gaps, improve UX, and open alpha to a limited player group.

**Deliverables**:
- [ ] World changes feed (global activity log)
- [ ] In-game messaging (player-to-player, alliance chat)
- [ ] Royalty system implemented and tested
- [ ] End-to-end gameplay loop playtest with 5–10 players
- [ ] Performance audit (galaxy map, market queries)
- [ ] Error handling and user-facing error messages

**Exit criteria**: The core loop (discover → survey → claim → grow → trade) is playable end-to-end by multiple simultaneous players.

---

## Future Phases (Post-Alpha, Not Scheduled)

- Ship construction and ship class diversity
- Combat system (intentionally excluded from alpha)
- Fulfilled shipping orders (seller ships goods to buyer)
- Alliance diplomacy (formal treaties)
- Planetary events (random events from seeds, e.g., resource booms/busts)
- Mobile-responsive UI improvements
- Leaderboards and achievement system
