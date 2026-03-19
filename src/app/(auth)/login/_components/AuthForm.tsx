"use client";

/**
 * Client-side auth form — sign in and sign up.
 *
 * Sign-up flow:
 *   1. User picks a handle (display name), email, and password.
 *   2. supabase.auth.signUp() is called with the handle stored in user_metadata.
 *   3. If the session is returned immediately (email confirmation disabled),
 *      the user is redirected to /game.
 *   4. If email confirmation is required, a "check your email" message is shown.
 *
 * The handle is stored in auth user_metadata here and consumed by
 * bootstrapPlayer() (in lib/actions/bootstrap.ts) on the first game page load.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { HANDLE_MIN_LENGTH, HANDLE_MAX_LENGTH } from "@/lib/config/constants";

type Mode = "signin" | "signup";

export function AuthForm() {
  const [mode, setMode] = useState<Mode>("signin");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setError(error.message);
          return;
        }

        router.push("/game");
      } else {
        // --- Sign-up validation ---
        const trimmedHandle = handle.trim();

        if (trimmedHandle.length < HANDLE_MIN_LENGTH) {
          setError(
            `Handle must be at least ${HANDLE_MIN_LENGTH} characters.`,
          );
          return;
        }
        if (trimmedHandle.length > HANDLE_MAX_LENGTH) {
          setError(`Handle must be ${HANDLE_MAX_LENGTH} characters or fewer.`);
          return;
        }
        if (password.length < 6) {
          setError("Password must be at least 6 characters.");
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { handle: trimmedHandle },
          },
        });

        if (error) {
          setError(error.message);
          return;
        }

        if (data.session) {
          // Email confirmation is disabled — session is active immediately.
          router.push("/game");
        } else {
          // Email confirmation required.
          setInfo(
            "Account created. Check your email for a confirmation link, then sign in.",
          );
          switchMode("signin");
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Mode toggle */}
      <div className="mb-6 flex rounded-md border border-zinc-700 bg-zinc-800 p-0.5">
        <button
          type="button"
          onClick={() => switchMode("signin")}
          className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors ${
            mode === "signin"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-300"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => switchMode("signup")}
          className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors ${
            mode === "signup"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-300"
          }`}
        >
          Sign up
        </button>
      </div>

      {/* Status messages */}
      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {info && (
        <div className="mb-4 rounded border border-emerald-800 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
          {info}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Handle — sign-up only */}
        {mode === "signup" && (
          <div>
            <label
              htmlFor="handle"
              className="mb-1 block text-xs font-medium text-zinc-400"
            >
              Pilot handle
            </label>
            <input
              id="handle"
              type="text"
              autoComplete="username"
              required
              minLength={HANDLE_MIN_LENGTH}
              maxLength={HANDLE_MAX_LENGTH}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="e.g. Nova_Rhea"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-zinc-600">
              {HANDLE_MIN_LENGTH}–{HANDLE_MAX_LENGTH} characters. This is your
              in-game display name.
            </p>
          </div>
        )}

        {/* Email */}
        <div>
          <label
            htmlFor="email"
            className="mb-1 block text-xs font-medium text-zinc-400"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Password */}
        <div>
          <label
            htmlFor="password"
            className="mb-1 block text-xs font-medium text-zinc-400"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={mode === "signup" ? 6 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "At least 6 characters" : ""}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? mode === "signin"
              ? "Signing in…"
              : "Creating account…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>
    </div>
  );
}
