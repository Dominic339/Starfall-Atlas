# Starfall Atlas

A shared-universe browser strategy and economy game built on real star data.

> **Status**: Active development — Pre-alpha (Phase 0: Foundation)

---

## What is Starfall Atlas?

Starfall Atlas is a persistent, multiplayer browser game set in a galaxy built from a real star catalog. All players share one universe. Starting from Sol, you expand outward by discovering systems, surveying planets, claiming colony sites, building infrastructure, and participating in a fully player-driven economy.

There is no combat in the current alpha. The core loop is exploration, economy, and trade diplomacy.

**Core gameplay:**
- Discover star systems and survey their planets
- Claim habitable bodies and establish colonies
- Generate in-game currency (Credits) from colony taxes — the only currency source
- Extract resources and transport them via hyperspace lanes
- Buy and sell resources on regional player-driven markets
- Build and tax hyperspace lanes between owned systems
- Form trade alliances (up to 100 members) with shared storage and internal credits
- Auction or sell colonies and systems to other players
- Access a premium shop for cosmetics and select single-use mobility items

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org/) (App Router) |
| Language | TypeScript |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) |
| Validation | [Zod](https://zod.dev/) |
| Database + Auth | [Supabase](https://supabase.com/) (Postgres + Auth + Realtime) |
| Hosting | [Vercel](https://vercel.com/) |

---

## Project Structure

```
starfall-atlas/
├── src/
│   ├── app/           # Next.js App Router pages and API routes
│   ├── lib/           # Game logic, Supabase clients, world generation
│   └── types/         # Shared TypeScript types
├── docs/              # Design documents (see below)
├── supabase/
│   └── migrations/    # Postgres migration files
└── public/            # Static assets
```

---

## Documentation

All design decisions are documented in the `docs/` folder:

| File | Description |
|------|-------------|
| [`docs/GAME_RULES.md`](docs/GAME_RULES.md) | Authoritative game rules: discovery, claims, economy, travel, markets, alliances, premium items |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Technical architecture: Next.js + Supabase design, server-authoritative patterns, concurrency |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Implementation phases from foundation to alpha |
| [`docs/SCHEMA_NOTES.md`](docs/SCHEMA_NOTES.md) | Data model: all tables, enums, relationships, and transaction requirements |
| [`docs/CLAUDE_WORKFLOW.md`](docs/CLAUDE_WORKFLOW.md) | AI contributor behavior contract for this repo |

**Read the docs before writing code.** The schema and architecture docs are the source of truth.

---

## Getting Started

### Prerequisites

- Node.js 20+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- A Supabase project (create one at [supabase.com](https://supabase.com))

### 1. Clone and install

```bash
git clone https://github.com/Dominic339/Starfall-Atlas.git
cd Starfall-Atlas
npm install
```

### 2. Configure environment

Copy the example env file and fill in your Supabase credentials:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

> The `SERVICE_ROLE_KEY` is used server-side only (Next.js Route Handlers) and must never be exposed to the browser.

### 3. Apply database migrations

```bash
supabase db push
```

Or for local development with the Supabase CLI:

```bash
supabase start
supabase db reset
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Development Guidelines

- **All game state writes go through the Next.js API layer.** The browser Supabase client is read-only for game data.
- **Critical actions (claims, trades, bids) use Postgres transactions** with row-level locking to prevent race conditions.
- **The world is deterministic.** Star data, system bodies, and base resource profiles are generated from a seed and never stored in Supabase.
- **No combat, no real-time simulation.** Travel and construction use timestamp-based completion, resolved lazily.
- **First colony is free.** Pre-colony players have free lane transit so they can never be trapped.

See [`docs/CLAUDE_WORKFLOW.md`](docs/CLAUDE_WORKFLOW.md) for the full contributor behavioral contract.

---

## Current Roadmap Status

We are in **Phase 0 (Foundation)**. The project scaffold exists and documentation is being established before any gameplay code is written.

Next steps:
1. Complete Phase 0 documentation
2. Write Supabase migrations (Phase 1)
3. Implement star catalog and world generation (Phase 2)
4. Auth and player initialization (Phase 3)

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full plan.

---

## Contributing

This project is in early development. If you are contributing:

1. Read `docs/GAME_RULES.md` and `docs/ARCHITECTURE.md` fully before writing code.
2. Work on the designated feature branch (never push to `main`).
3. Ensure `npm run build` and `npm run lint` pass before submitting changes.
4. Update the relevant `docs/` file if your change affects rules, schema, or architecture.

---

## License

Private repository. All rights reserved.
