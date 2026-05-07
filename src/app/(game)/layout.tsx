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

import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { bootstrapPlayer } from "@/lib/actions/bootstrap";
import { signOut } from "@/lib/actions/signout";
import { NavBar } from "@/app/(game)/game/_components/NavBar";
import { PageTransition } from "@/app/(game)/game/_components/PageTransition";

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
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <NavBar handle={player.handle} signOutAction={signOut} />

      {/* Page content — animates in on every navigation */}
      <main className="flex flex-1 flex-col overflow-y-auto">
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
