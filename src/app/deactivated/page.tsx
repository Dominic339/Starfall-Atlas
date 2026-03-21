/**
 * Deactivated account landing page.
 * Shown when a player's account has been soft-deleted.
 */

import { signOut } from "@/lib/actions/signout";

export const metadata = { title: "Account Deactivated — Starfall Atlas" };

export default function DeactivatedPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center space-y-4">
        <h1 className="text-xl font-semibold text-zinc-100">Account Deactivated</h1>
        <p className="text-sm text-zinc-400">
          Your account has been deactivated. Your data will be permanently removed
          within 30 days.
        </p>
        <p className="text-xs text-zinc-600">
          If you believe this was a mistake, contact support before your data is
          removed.
        </p>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md bg-zinc-700 px-5 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
