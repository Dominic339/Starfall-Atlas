/**
 * Admin dashboard page.
 *
 * PLACEHOLDER — No operational admin tools yet.
 * TODO(phase-13): Add fast-forward controls, resource grants, player lookup.
 *
 * Access is gated by requireAdmin() which checks ADMIN_AUTH_IDS env var.
 */

import { requireAdmin } from "@/lib/admin/guard";
import { toErrorResponse } from "@/lib/actions/helpers";

export default async function AdminPage() {
  const authCheck = await requireAdmin();

  if (!authCheck.ok) {
    // Server Component redirect on auth failure
    // In a real implementation, use redirect() from next/navigation.
    // For now, render a minimal error to keep the build clean.
    return (
      <div className="rounded border border-red-800 bg-red-950 p-4 text-red-300">
        <p className="font-mono text-sm">
          Access denied: {authCheck.error.message}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Authenticated as {authCheck.data.authId}
        </p>
      </div>

      {/* PLACEHOLDER: Admin tools will be added in Phase 13 */}
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <p className="font-mono text-sm text-zinc-500">
          {/* TODO(phase-13): Add admin controls here */}
          No admin tools configured yet.
        </p>
      </div>
    </div>
  );
}
