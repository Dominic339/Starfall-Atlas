# Starfall Atlas — Claude Workflow

> Version: 0.1
> Last updated: 2026-03-16

This document defines how Claude (AI assistant) should operate in this repository. It serves as a behavioral contract for any AI-assisted development session. Refer to this file before making any changes to the codebase.

---

## 1. Guiding Principles

1. **Correctness over speed.** Do not write speculative or placeholder implementations for production paths without labeling them clearly. If something cannot be safely implemented in the current phase, document it rather than stub it incorrectly.
2. **No unnecessary changes.** Only touch files required for the current task. Do not refactor, reformat, or "improve" unrelated code.
3. **Consistency with docs.** The `docs/` folder is the source of truth. Code must conform to it. If code would contradict a rule in `GAME_RULES.md` or `ARCHITECTURE.md`, update the docs first and explain the change.
4. **Safety first for game-critical actions.** Any action that touches Credits, resources, claims, auctions, or premium entitlements must use server-side transactions. Never allow a client-side shortcut.
5. **Minimal dependency sprawl.** Do not add new npm packages without a clear, specific need. Prefer the existing stack (Next.js, Supabase, Zod, Tailwind) and standard library patterns.

---

## 2. Build Integrity

- **Never leave the build broken.** Before committing, confirm `npm run build` and `npm run lint` pass. If they do not, fix the errors before committing.
- **Never skip type checking.** TypeScript errors are not warnings. They must be resolved. Do not use `// @ts-ignore` or `// @ts-expect-error` without a code comment explaining why it is unavoidable and safe.
- **Do not modify `next.config.ts` or `tsconfig.json`** without a specific documented reason. These files affect the entire build.
- **Do not modify `package.json` or install packages** unless the task explicitly requires a new dependency.

---

## 3. Branch Rules

- **Develop on the designated feature branch**, as specified in the session instructions. Never push directly to `main` or `master`.
- Use the `dev` branch or a `claude/*` feature branch as instructed.
- Commit messages must be descriptive and follow this format:
  ```
  <type>: <short summary>

  <optional body with more detail>
  ```
  Types: `docs`, `feat`, `fix`, `refactor`, `chore`, `test`.

---

## 4. Documentation Rules

- **Update docs when rules or architecture change.** If a game rule changes, update `GAME_RULES.md`. If the data model changes, update `SCHEMA_NOTES.md`. If a new system is added, update `ARCHITECTURE.md` and the relevant phase in `ROADMAP.md`.
- **Mark roadmap items complete** when a phase deliverable is implemented.
- **Do not add placeholder content to docs** that contradicts or is inconsistent with the existing rules. Prefer a clearly marked `> TODO:` block over speculative content.

---

## 5. Server-Side Safety Patterns

All of the following must happen server-side (Next.js Route Handler or Server Action) and must never be performed or trusted from the client:

| Action | Required server-side steps |
|--------|---------------------------|
| Claim a body | Transaction + SELECT FOR UPDATE on body; check unclaimed |
| Collect taxes | Calculate yield lazily from timestamps; credit atomically |
| Market order post | Deduct listing fee; hold escrow; attempt match — all in one transaction |
| Bid placement | Lock auction row; check bid amount; manage escrow atomically |
| Alliance storage withdrawal | Lock alliance_members + resource_inventory; check credits and stock |
| Premium item use | Lock entitlement row; verify not consumed; apply effect; mark consumed |
| Travel submission | Validate route; check ship is free; insert travel_job with computed arrive_at |
| Arrival resolution | Verify arrive_at in the past; apply outcomes; update ship location |

Never read-then-write outside of a transaction for any of the above. Race conditions on these actions can create duplicate currency, duplicate claims, or corrupted inventory.

---

## 6. Data Access Rules

- **Never write game state from the browser client.** The browser Supabase client is for read-only operations (map data, market listings, discovery feed) and auth session management only.
- **All writes go through the Next.js API layer** where the service-role Supabase client is used after server-side authorization checks.
- **Row-Level Security (RLS) is defense-in-depth**, not the primary authorization mechanism. RLS denies direct client writes to game state tables. The API layer performs business logic authorization first.
- **Validate all external input with Zod** before it touches the database. The Zod schema is the contract between the client and the API.

---

## 7. World Generation Rules

- **Never store deterministic world data in Supabase.** Star positions, body types, base resource profiles, system names, and lane range limits are all generated from the seed. They must never be written to the database.
- **All generation functions must be pure and deterministic.** The same `system_id` must always produce the same output. Tests must verify this.
- **The star catalog is a static asset**, not a database table. It ships with the application code.

---

## 8. Placeholder and TODO Rules

When a feature is incomplete or deferred:

- Mark it clearly with a `// TODO(phase-N):` comment in code.
- If a placeholder route or function is added, name it clearly and add a `// PLACEHOLDER: not implemented` comment at the top.
- Do not ship placeholder API routes that silently succeed or return fake data without a visible warning.
- Prefer returning `501 Not Implemented` from unfinished endpoints over stubbed success responses.

---

## 9. Economy and Balance Rules

- **No new sources of Credit generation** may be added without updating `GAME_RULES.md` Section 7 and the team agreeing. The economy rule (taxes only) is a core design constraint.
- **Premium items must not grant direct competitive advantages** beyond what is documented in `GAME_RULES.md` Section 14 and 15. Any new premium item must be reviewed against the anti-pay-to-win guardrails.
- **Market fee burns must be tracked.** Any change to the fee structure must update the relevant market logic and docs.

---

## 10. Testing Expectations

- **Deterministic generation functions must have unit tests** (same seed → same output).
- **Transaction-based actions should have integration tests** that verify contention is handled correctly.
- **API route handlers should have tests** that verify authentication, validation, and correct game state transitions.
- Tests live in `src/__tests__/` or colocated as `*.test.ts` files.
- `npm run lint` and `npm run build` must pass before committing.

---

## 11. What Not to Do

- Do not add combat mechanics. Combat is explicitly excluded from alpha scope.
- Do not add real-time ship animation or 3D rendering. The game is 2D and timestamp-based.
- Do not add an NPC market. The economy is entirely player-driven.
- Do not implement features that are not in the current roadmap phase without explicit instruction.
- Do not add dependencies for features that don't exist yet (no pre-installing a WebSocket library "for later").
- Do not modify Supabase Auth configuration in code. Auth setup is done in the Supabase dashboard.
