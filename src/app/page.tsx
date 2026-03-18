/**
 * Landing page — shown to unauthenticated visitors.
 *
 * Authenticated users are redirected to /game by middleware.
 * This page is intentionally minimal: the game experience begins at /game.
 */

import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 px-8 py-4">
        <span className="font-mono text-sm font-medium text-zinc-400">
          Starfall Atlas
        </span>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-8 py-24 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          A galaxy to explore.
          <br />
          <span className="text-indigo-400">One universe, all players.</span>
        </h1>

        <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
          Starfall Atlas is a persistent multiplayer strategy game built on a
          real star catalog. Discover systems, claim planets, build colonies,
          and compete in a fully player-driven economy — all without real-time
          combat.
        </p>

        {/* Feature list */}
        <ul className="mt-8 grid grid-cols-1 gap-3 text-left text-sm text-zinc-500 sm:grid-cols-2 sm:gap-4">
          {[
            "Explore 100,000+ real star systems",
            "Claim stewardship of newly discovered systems",
            "Build colonies and generate in-game Credits",
            "Trade resources on player-driven regional markets",
            "Form alliances and contest majority system control",
            "No pay-to-win — premium items are cosmetics only",
          ].map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <span className="mt-0.5 text-indigo-500">◆</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row">
          <Link
            href="/login?mode=signup"
            className="rounded-lg bg-indigo-600 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            Create account
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-zinc-700 px-8 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
          >
            Sign in
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-8 py-4 text-center">
        <p className="text-xs text-zinc-700">
          Pre-alpha · Phase 3 · All rights reserved.
        </p>
      </footer>
    </div>
  );
}
