/**
 * Login / sign-up page.
 * Server component shell — the interactive form is a client component.
 *
 * force-dynamic: this page uses Supabase Auth (via the AuthForm client
 * component) which requires environment variables at runtime, not build time.
 */

import { AuthForm } from "./_components/AuthForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — Starfall Atlas",
};

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Logo / title */}
      <div className="mb-8 text-center animate-fade-in-up">
        <div className="mb-3 inline-flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-400" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <circle cx="8" cy="8" r="1.8" />
            <circle cx="2.5" cy="3.5" r="0.9" opacity="0.55" />
            <circle cx="13.5" cy="2.5" r="0.9" opacity="0.55" />
            <circle cx="13" cy="12" r="0.9" opacity="0.45" />
            <line x1="8" y1="8" x2="2.5" y2="3.5" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
            <line x1="8" y1="8" x2="13.5" y2="2.5" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
            <line x1="8" y1="8" x2="13" y2="12" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
          </svg>
          <span className="font-mono text-xs font-semibold tracking-widest uppercase text-shimmer">
            Starfall Atlas
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          A shared universe, built on real star data.
        </p>
      </div>

      {/* Auth form */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl animate-fade-in-up" style={{ animationDelay: "60ms" }}>
        <AuthForm />
      </div>
    </div>
  );
}
