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
    <div className="w-full max-w-sm">
      {/* Logo / title */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Starfall Atlas
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          A shared universe, built on real star data.
        </p>
      </div>

      {/* Auth form */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        <AuthForm />
      </div>
    </div>
  );
}
