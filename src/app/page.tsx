/**
 * Landing page — shown to unauthenticated visitors.
 *
 * Authenticated users are redirected to /game by middleware.
 */

import Link from "next/link";

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41Z" clipRule="evenodd" />
      </svg>
    ),
    label: "Explore 100,000+ real star systems",
    color: "text-indigo-400",
    bg: "bg-indigo-950/50 border-indigo-800/30",
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clipRule="evenodd" />
      </svg>
    ),
    label: "Claim stewardship of newly discovered systems",
    color: "text-amber-400",
    bg: "bg-amber-950/50 border-amber-800/30",
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M10.75 10.818v2.614A3.13 3.13 0 0 0 11.888 13c.482-.315.612-.648.612-.875 0-.227-.13-.560-.612-.875a3.13 3.13 0 0 0-1.138-.432ZM8.33 8.62c.053.055.115.11.184.164.208.16.46.284.736.363V6.603a2.45 2.45 0 0 0-.35.13c-.14.065-.27.143-.386.233-.377.292-.514.627-.514.909 0 .184.058.39.33.784Z" />
        <path fillRule="evenodd" d="M9.99 2a8 8 0 1 0 .02 16.001A8 8 0 0 0 9.99 2ZM10 4a6 6 0 1 0 0 12A6 6 0 0 0 10 4Zm0 2.5v.25A1.75 1.75 0 0 1 10 10.5v.25c.966.224 1.75.996 1.75 1.875C11.75 13.773 11.018 14.5 10 14.5s-1.75-.727-1.75-1.875A1.75 1.75 0 0 1 10 10.75V10.5a1.75 1.75 0 0 1-1.75-1.75V8.5A1.75 1.75 0 0 1 10 6.75v-.25Z" clipRule="evenodd" />
      </svg>
    ),
    label: "Build colonies and generate in-game Credits",
    color: "text-emerald-400",
    bg: "bg-emerald-950/50 border-emerald-800/30",
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M12.577 4.878a.75.75 0 0 1 .919-.53l4.78 1.281a.75.75 0 0 1 .531.919l-1.281 4.78a.75.75 0 0 1-1.449-.387l.81-3.022a19.407 19.407 0 0 0-5.594 5.203.75.75 0 0 1-1.139.093L7 10.06l-4.72 4.72a.75.75 0 0 1-1.06-1.061l5.25-5.25a.75.75 0 0 1 1.06 0l3.074 3.073a20.923 20.923 0 0 1 5.545-4.931l-3.042-.815a.75.75 0 0 1-.53-.918Z" clipRule="evenodd" />
      </svg>
    ),
    label: "Trade resources on player-driven markets",
    color: "text-sky-400",
    bg: "bg-sky-950/50 border-sky-800/30",
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM1.49 15.326a.78.78 0 0 1-.358-.442 3 3 0 0 1 4.308-3.516 6.484 6.484 0 0 0-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 0 1-2.07-.655ZM16.44 15.98a4.97 4.97 0 0 0 2.07-.654.78.78 0 0 0 .357-.442 3 3 0 0 0-4.308-3.517 6.484 6.484 0 0 1 1.907 3.96 2.32 2.32 0 0 1-.026.654ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5.304 16.19a.844.844 0 0 1-.277-.71 5 5 0 0 1 9.947 0 .843.843 0 0 1-.277.71A6.975 6.975 0 0 1 10 18a6.974 6.974 0 0 1-4.696-1.81Z" />
      </svg>
    ),
    label: "Form alliances and contest majority system control",
    color: "text-violet-400",
    bg: "bg-violet-950/50 border-violet-800/30",
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M16.403 12.652a3 3 0 0 0 0-5.304 3 3 0 0 0-3.75-3.751 3 3 0 0 0-5.305 0 3 3 0 0 0-3.751 3.75 3 3 0 0 0 0 5.305 3 3 0 0 0 3.75 3.751 3 3 0 0 0 5.305 0 3 3 0 0 0 3.751-3.75Zm-2.546-4.46a.75.75 0 0 0-1.214-.883l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
      </svg>
    ),
    label: "No pay-to-win — cosmetics are ship & station skins only",
    color: "text-teal-400",
    bg: "bg-teal-950/50 border-teal-800/30",
  },
];

export default function HomePage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Atmospheric background glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-indigo-900/10 blur-[120px]" />
        <div className="absolute top-1/3 -left-48 w-[400px] h-[400px] rounded-full bg-violet-900/8 blur-[100px]" />
        <div className="absolute bottom-0 right-0 w-[350px] h-[350px] rounded-full bg-indigo-800/8 blur-[100px]" />
        {/* Star dots */}
        <svg className="absolute inset-0 w-full h-full opacity-30" xmlns="http://www.w3.org/2000/svg">
          {[
            [8, 12], [15, 45], [22, 78], [31, 23], [44, 67], [52, 8], [63, 55], [71, 34],
            [82, 88], [90, 15], [7, 90], [37, 40], [58, 72], [76, 60], [93, 45],
            [19, 30], [48, 90], [85, 25], [27, 65], [67, 18],
          ].map(([x, y], i) => (
            <circle
              key={i}
              cx={`${x}%`}
              cy={`${y}%`}
              r={i % 3 === 0 ? 1.2 : i % 5 === 0 ? 1.5 : 0.8}
              fill="white"
              className="galaxy-star-twinkle"
              style={{ animationDelay: `${i * 0.4}s`, animationDuration: `${3 + (i % 3)}s` }}
            />
          ))}
        </svg>
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-zinc-800/60 px-8 py-4">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-indigo-400 animate-star-drift" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <circle cx="8" cy="8" r="1.8" />
              <circle cx="2.5" cy="3.5" r="0.9" opacity="0.55" />
              <circle cx="13.5" cy="2.5" r="0.9" opacity="0.55" />
              <circle cx="13" cy="12" r="0.9" opacity="0.45" />
              <circle cx="3" cy="13" r="0.7" opacity="0.35" />
              <line x1="8" y1="8" x2="2.5" y2="3.5" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
              <line x1="8" y1="8" x2="13.5" y2="2.5" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
              <line x1="8" y1="8" x2="13" y2="12" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
            </svg>
            <span className="text-shimmer font-mono text-xs font-semibold tracking-widest uppercase">
              Starfall Atlas
            </span>
          </div>
          <Link
            href="/login"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Sign in →
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 py-24 text-center">
        {/* Pre-title badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-800/50 bg-indigo-950/40 px-3 py-1 text-xs text-indigo-400 animate-fade-in-up">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          Persistent multiplayer · Real star catalog
        </div>

        <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl lg:text-6xl leading-tight animate-fade-in-up" style={{ animationDelay: "60ms" }}>
          A galaxy to explore.
          <br />
          <span className="text-shimmer" style={{ fontWeight: 600 }}>One universe, all players.</span>
        </h1>

        <p className="mt-6 max-w-lg text-base leading-relaxed text-zinc-400 animate-fade-in-up" style={{ animationDelay: "120ms" }}>
          Starfall Atlas is a persistent multiplayer strategy game built on a
          real star catalog. Discover systems, found colonies, and compete in
          a fully player-driven economy — no real-time combat required.
        </p>

        {/* Feature grid */}
        <ul className="mt-10 grid grid-cols-1 gap-2.5 text-left sm:grid-cols-2 max-w-2xl w-full stagger-children">
          {FEATURES.map((f) => (
            <li
              key={f.label}
              className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 ${f.bg} card-interactive animate-fade-in-up`}
            >
              <span className={`shrink-0 ${f.color}`}>{f.icon}</span>
              <span className="text-sm text-zinc-300">{f.label}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="mt-12 flex flex-col items-center gap-3 sm:flex-row animate-fade-in-up" style={{ animationDelay: "280ms" }}>
          <Link
            href="/login?mode=signup"
            className="relative rounded-lg bg-indigo-600 px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-900/50 btn-glow"
          >
            Create account
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-zinc-700 px-8 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          >
            Sign in
          </Link>
        </div>

        <p className="mt-6 text-xs text-zinc-700">Free to play · No download required</p>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-zinc-800/60 px-8 py-4 text-center">
        <p className="text-xs text-zinc-700">
          Pre-alpha · All rights reserved
        </p>
      </footer>
    </div>
  );
}
