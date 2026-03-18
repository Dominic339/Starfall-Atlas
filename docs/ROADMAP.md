# Starfall Atlas — Roadmap

> Version: 0.2 (Alpha Design)
> Last updated: 2026-03-18

This roadmap describes the planned implementation phases for Starfall Atlas. The goal is a fast alpha focused on the core economy and exploration loop, with no combat and no real-time simulation.

Each phase has a clear deliverable and exit criteria. Phases are sequential; later phases may be reprioritized based on playtest feedback.

---

## Phase 0 — Foundation ✅ Complete

**Goal**: Establish a clean, buildable project with authoritative documentation and schema design before writing any gameplay code.

**Deliverables**:
- [x] Next.js + Supabase scaffold created
- [x] Tailwind CSS, Zod, and `@supabase/ssr` installed
- [x] `docs/GAME_RULES.md` — authoritative game rules (v0.2, governance model)
- [x] `docs/ARCHITECTURE.md` — system design (v0.2)
- [x] `docs/SCHEMA_NOTES.md` — data model notes (v0.2)
- [x] `docs/ROADMAP.md` — this file
- [x] `docs/CLAUDE_WORKFLOW.md` — AI contributor workflow
- [x] `README.md` — project overview and setup
- [ ] Supabase project created and linked *(external setup, depends on account)*
- [x] Initial migration file structure in `supabase/migrations/`

**Exit criteria**: All docs are complete and internally consistent. The app builds and runs with `npm run dev`. ✅

---

## Phase 1 — Schema and Migrations ✅ Complete

**Goal**: Translate `SCHEMA_NOTES.md` into real, runnable Supabase migrations. No gameplay logic yet.

**Deliverables**:
- [x] `supabase/migrations/00001_enums.sql` — all DB enums
- [x] `supabase/migrations/00002_players_ships.sql` — player accounts, ships
- [x] `supabase/migrations/00003_world.sql` — discoveries, survey jobs and results
- [x] `supabase/migrations/00004_colonies.sql` — colonies, structures, construction jobs
- [x] `supabase/migrations/00005_lanes.sql` — hyperspace lanes, lane construction jobs
- [x] `supabase/migrations/00006_travel.sql` — travel jobs
- [x] `supabase/migrations/00007_resources.sql` — resource inventory, EUX purchases
- [x] `supabase/migrations/00008_economy.sql` — market listings, trades, claim tickets, auctions, bids
- [x] `supabase/migrations/00009_alliances.sql` — alliances, members, goals, contributions
- [x] `supabase/migrations/00010_premium.sql` — premium entitlements
- [x] `supabase/migrations/00011_logs.sql` — world events log
- [x] `supabase/migrations/00012_indexes.sql` — performance indexes
- [x] `supabase/migrations/00013_rls.sql` — RLS policies for all tables
- [x] `supabase/migrations/00014_ownership_model_v2.sql` — governance v2: stewardship, majority control, influence cache, hyperspace gates, gate construction jobs, colony lifecycle (abandoned/collapsed), EUX table, updated enums and world event types
- [ ] Seed migration with Sol system as the starting system *(deferred to Phase 3)*

**Exit criteria**: `supabase db push` runs cleanly. All tables exist with correct columns, constraints, and RLS. ✅

---

## Phase 2 — Application Foundation ✅ Mostly Complete

**Goal**: Build the application scaffolding: Supabase helpers, shared types, config layer, and deterministic world generation foundation.

**Deliverables**:
- [x] `src/lib/supabase/client.ts` — browser Supabase client (read-only game data, auth)
- [x] `src/lib/supabase/server.ts` — server-side Supabase client (cookies/session-aware)
- [x] `src/lib/supabase/admin.ts` — service-role client for server-side game state writes
- [x] `src/lib/supabase/utils.ts` — shared Supabase helper utilities
- [x] `src/middleware.ts` — Next.js route protection (redirects unauthenticated users)
- [x] `src/lib/types/game.ts` — core game entity TypeScript types
- [x] `src/lib/types/enums.ts` — TypeScript mirrors of all DB enums
- [x] `src/lib/types/api.ts` — API request/response types
- [x] `src/lib/types/generated.ts` — Supabase-generated DB types
- [x] `src/lib/config/constants.ts` — stable constants (Sol system ID, resource names, etc.)
- [x] `src/lib/config/balance.ts` — tunable balance values (tax rates, influence formula, costs)
- [x] `src/lib/game/rng.ts` — seeded pseudo-random number generation (deterministic)
- [x] `src/lib/game/generation.ts` — deterministic system and body generation from star seed
- [x] `src/lib/game/resources.ts` — deterministic resource profiles per body
- [x] `src/lib/game/habitability.ts` — body habitability scoring
- [x] `src/lib/game/travel.ts` — travel duration and distance calculations
- [x] `src/lib/game/taxes.ts` — lazy tax accumulation calculation
- [ ] Real star catalog imported as a static asset *(integration point exists in `generation.ts`; catalog not yet loaded)*
- [ ] Unit tests for generation functions (same seed → same output)

**Exit criteria**: All generation functions are pure and deterministic. Supabase helpers work with cookie-based sessions. Config layer is in place with balance values matching GAME_RULES.md.

---

## Phase 3 — Auth and Player Setup

**Goal**: Players can register, log in, and are initialized in the game world at Sol.

**Deliverables**:
- [x] `src/middleware.ts` — route protection (done in Phase 2)
- [x] `src/lib/supabase/server.ts` and `client.ts` set up correctly (done in Phase 2)
- [ ] Register/login pages
- [ ] On first login: player row inserted with starting wallet (0 credits) and starter ship at Sol
- [ ] Player profile page (basic: handle, wallet balance, colonies owned)
- [ ] Sol system seed migration (marks Sol as discovered for all players at game start)

**Exit criteria**: A user can register, log in, see their profile, and their starter ship appears at Sol.

---

## Phase 4 — Discovery and Survey Actions

**Goal**: Players can discover star systems and survey bodies.

**Deliverables**:
- [ ] `POST /api/game/travel` — submit a travel job to a reachable system
- [ ] Travel job resolution (lazy, on player return)
- [ ] `POST /api/game/discover` — mark a system as discovered; atomically register stewardship for first discoverer
- [ ] `POST /api/game/survey` — submit a survey job for a body
- [ ] Survey job resolution (lazy)
- [ ] Discovery log feed (shared, shows recent first-discoveries with stewardship badge)
- [ ] System detail page: discovered bodies, survey status, resource profiles (if surveyed), governance status

**Exit criteria**: A player can travel from Sol to an adjacent system, discover it (becoming its steward), and survey a body to see its resource profile.

---

## Phase 5 — Claims, Colony Basics, and Influence

**Goal**: Players can claim a body, establish a colony, collect taxes, and begin building system influence.

**Deliverables**:
- [ ] `POST /api/game/claim` — claim a body (contention handling via DB transaction; steward and non-steward paths)
- [ ] First colony is free; subsequent colonies require resources (from `balance.ts`)
- [ ] Colony detail page: population tier, structures, tax status, influence contribution
- [ ] `POST /api/game/colony/collect-taxes` — collect accumulated taxes
- [ ] Tax calculation function (reads `last_tax_collected_at`, calculates yield, caps at 24h)
- [ ] `src/lib/game/influence.ts` — influence formula: `10 × tier` per colony + structure bonuses
- [ ] `system_influence_cache` updated on colony claim, tier change, abandonment, collapse
- [ ] System influence panel: shows per-player/alliance influence breakdown for any discovered system
- [ ] Activity indicators on colony and system pages

**Exit criteria**: A player can claim a body, establish a colony, collect their first tax income, and the system influence panel shows their influence score.

---

## Phase 6 — Structures and Resource Extraction

**Goal**: Players can build structures and generate resources.

**Deliverables**:
- [ ] `POST /api/game/colony/build` — queue a construction job for a structure (resource cost from colony inventory)
- [ ] Construction job resolution (lazy)
- [ ] Extractor produces resources on tick (lazy calculation, same pattern as taxes)
- [ ] Warehouse increases storage cap
- [ ] Resource inventory views for colonies and ships
- [ ] Resource transport (load/unload ship cargo via travel)
- [ ] Gate influence bonus: gate owner gains `+50` influence in their system

**Exit criteria**: A player can build an Extractor, accumulate resources, and transport them via ship.

---

## Phase 7 — Hyperspace Gates and Lanes

**Goal**: Players can build gates, construct lanes, and manage access and transit taxes.

**Deliverables**:
- [ ] `POST /api/game/gate/build` — governance holder initiates gate construction job
- [ ] Gate construction job resolution (lazy)
- [ ] `POST /api/game/gate/reclaim` — new governance holder reclaims a neutral gate
- [ ] `POST /api/game/lane/build` — queue lane construction job (requires gates at both endpoints)
- [ ] Lane access level settings (public/alliance/private)
- [ ] Transit tax settings (validated against 5% cap)
- [ ] Pre-colony free travel rule enforced server-side
- [ ] Relay Station extends lane range (calculated in `src/lib/game/travel.ts`)
- [ ] Lane and gate network visible on galaxy map (governance-colored nodes, lane lines)
- [ ] Gate neutralization on governance transfer (atomic with transfer action)

**Exit criteria**: A player can build a gate, construct a lane, set a transit tax, and other players can travel it (paying the tax). Governance transfer correctly neutralizes the gate.

---

## Phase 8 — Majority Control and Governance Transitions

**Goal**: Players who develop a system sufficiently can claim majority control and take over governance.

**Deliverables**:
- [ ] `POST /api/game/governance/claim-majority` — alliance or player claims majority when threshold met
- [ ] Majority control validation (≥3 active colonies; >50% system influence from `system_influence_cache`)
- [ ] Governance transfer: `system_stewardship.has_governance = FALSE`; gate neutralized atomically
- [ ] `POST /api/game/governance/contest` — trigger re-check when majority controller's influence may have dropped
- [ ] Governance display on system page: steward (discovery credit), current governance holder, majority controller if different
- [ ] World events: `majority_control_gained`, `majority_control_lost`

**Exit criteria**: An alliance that builds enough colonies in a system can claim majority control. The steward's governance flag is cleared. The gate becomes neutral until reclaimed.

---

## Phase 9 — Inactivity and Colony Collapse

**Goal**: Inactive players' colonies enter abandonment and eventually collapse, freeing up bodies.

**Deliverables**:
- [ ] Inactivity check integrated into relevant server actions (lazy evaluation of `last_active_at`)
- [ ] Colony abandonment: set `status = 'abandoned'`, deactivate structures, zero influence
- [ ] 7-day resolution window: player can reactivate by logging in (no resource cost)
- [ ] Colony collapse: `status = 'collapsed'`, inventory cleared, body re-opened for claims
- [ ] Ruins mechanic: new colony owner can salvage structures at resource cost
- [ ] World events: `colony_abandoned`, `colony_collapsed`, `colony_reactivated`
- [ ] Governance lazy re-check after collapse reduces majority controller's influence

**Exit criteria**: A player's colonies that were abandoned for 7+ days collapse and their bodies become claimable by others.

---

## Phase 10 — Regional Markets

**Goal**: Players can buy and sell resources in regional markets.

**Deliverables**:
- [ ] `POST /api/game/market/list` — post a sell listing or buy order
- [ ] Market order matching (atomic, in transaction)
- [ ] Claim ticket issued to buyer; physical pickup via ship travel
- [ ] 2% listing fee burned
- [ ] Emergency Universal Exchange (EUX): common resources only, credit-burn, daily per-player limit
- [ ] Market UI: listings table, order form, own orders management, EUX panel

**Exit criteria**: Two players can trade a resource via the regional market. EUX is accessible as a last resort at premium pricing.

---

## Phase 11 — Auctions

**Goal**: Players can auction colony sites and system stewardship rights.

**Deliverables**:
- [ ] `POST /api/game/auction/create` — start an auction (colony or stewardship rights)
- [ ] `POST /api/game/auction/bid` — place a bid (escrow + anti-snipe)
- [ ] Auction resolution at `ends_at` (lazy, triggered when any player views the auction after it ends)
- [ ] Stewardship transfer on resolution (discovery credit permanently stays with original discoverer)
- [ ] Auction listing page (global auction board)

**Exit criteria**: A player can list a colony site or stewardship rights for auction. Ownership/governance transfers on resolution. Discovery credit is unaffected by stewardship sale.

---

## Phase 12 — Alliances

**Goal**: Players can form trade alliances with shared storage, internal credits, and collective majority control.

**Deliverables**:
- [ ] Alliance creation, invitation, and membership management
- [ ] Alliance Credits: earn via resource donation, spend via alliance ship withdrawal
- [ ] Alliance Ship Storage (shared inventory)
- [ ] Alliance Goals: Officers post goals, members contribute
- [ ] Alliance majority control: combined influence from all members treated as one block
- [ ] `POST /api/game/governance/claim-majority` supports alliance majority claim
- [ ] Alliance dashboard UI: roster, credits, storage, goals, systems governed

**Exit criteria**: An alliance can be formed, resources donated, goods withdrawn via Alliance Credits, and collective majority control claimed for a system.

---

## Phase 13 — Premium Shop (Cosmetics)

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

## Phase 14 — Premium Mobility Items

**Goal**: Add mobility and utility premium items, with anti-pay-to-win guardrails verified.

**Deliverables**:
- [ ] Unstable Warp Tunnel item (one-way, any discovered system, single use, consumes entitlement)
- [ ] Stabilized Wormhole item (persistent two-way lane between two player-governed systems; no gate required at far endpoint)
- [ ] Deep Survey Kit (reveals rare nodes; server verifies same node caps as basic survey)
- [ ] Colony Permit (+1 colony slot, max 2 per account)
- [ ] All items consumed server-side from `premium_entitlements`

**Exit criteria**: All four premium items work correctly. Anti-p2w guardrails (GAME_RULES.md §15) pass code review.

---

## Phase 15 — Alpha Polish and Open Testing

**Goal**: Close gameplay gaps, improve UX, and open alpha to a limited player group.

**Deliverables**:
- [ ] World changes feed (global activity log: colony events, governance changes, gate events, large trades)
- [ ] In-game messaging (player-to-player, alliance chat)
- [ ] Royalty system: governance holder receives royalty on non-governing extractors (lazy calculation, same pattern as taxes)
- [ ] Real star catalog integrated as a static asset and wired into `generation.ts`
- [ ] Unit tests for generation functions
- [ ] End-to-end gameplay loop playtest with 5–10 players
- [ ] Performance audit (galaxy map, market queries, influence cache)
- [ ] Error handling and user-facing error messages

**Exit criteria**: The core loop (discover → steward → claim → grow → influence → trade) is playable end-to-end by multiple simultaneous players.

---

## Future Phases (Post-Alpha, Not Scheduled)

- Ship construction and ship class diversity
- Combat system (intentionally excluded from alpha)
- Fulfilled shipping orders (seller ships goods to buyer)
- Alliance diplomacy (formal treaties)
- Planetary events (random events from seeds, e.g., resource booms/busts)
- Mobile-responsive UI improvements
- Leaderboards and achievement system
- Governance decay: stewardship that goes completely uncontested for very long periods
