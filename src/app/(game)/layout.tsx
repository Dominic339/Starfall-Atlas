/**
 * Game route group layout.
 *
 * This is the outer shell for all authenticated game pages (/game/*).
 * It does two things before rendering children:
 *
 *   1. Verifies the user is authenticated (middleware already enforces this,
 *      but we verify again here for defense-in-depth and to obtain the user
 *      object needed for bootstrap).
 *
 *   2. Calls bootstrapPlayer() — an idempotent function that creates the
 *      player row and starter ship on first login, or returns the existing
 *      player on all subsequent calls.
 *
 * The navigation bar shows the player's handle and a sign-out button.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { bootstrapPlayer } from "@/lib/actions/bootstrap";
import { signOut } from "@/lib/actions/signout";

export default async function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();

  // Middleware handles the redirect, but guard here in case it is bypassed.
  if (!user) {
    redirect("/login");
  }

  // Bootstrap is safe to call on every render — it returns the cached player
  // row immediately after the first call.
  const player = await bootstrapPlayer(user);

  // Deactivated accounts land on a dedicated page instead of the game.
  if (player.deactivated_at) {
    redirect("/deactivated");
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Navigation bar */}
      <header className="border-b border-zinc-800 bg-zinc-950 px-6 py-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-medium text-zinc-300">
            Starfall Atlas
          </span>
          <div className="flex items-center gap-5">
            <Link
              href="/game/profile"
              className="font-mono text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {player.handle}
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
