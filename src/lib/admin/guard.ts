/**
 * Admin guard: server-side authorization check for admin routes.
 *
 * Admin access is granted to auth UIDs listed in the ADMIN_AUTH_IDS
 * environment variable (comma-separated). No DB flag needed.
 *
 * Usage in Route Handlers and Server Components:
 *
 *   const check = await requireAdmin();
 *   if (!check.ok) return toErrorResponse(check.error);
 *
 * This guard is intentionally minimal for alpha. It can be extended
 * to support role-based admin levels later.
 */

import { getUser } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/types";

export interface AdminContext {
  authId: string;
}

/**
 * Verify the current session belongs to a registered admin.
 * Returns a fail result if unauthorized.
 */
export async function requireAdmin(): Promise<ActionResult<AdminContext>> {
  const user = await getUser();

  if (!user) {
    return fail("unauthorized", "Authentication required.");
  }

  const adminIds = parseAdminIds();

  if (adminIds.length === 0) {
    // No admins configured — fail closed for safety
    return fail(
      "forbidden",
      "Admin access is not configured. Set ADMIN_AUTH_IDS in environment.",
    );
  }

  if (!adminIds.includes(user.id)) {
    return fail("forbidden", "You do not have admin access.");
  }

  return { ok: true, data: { authId: user.id } };
}

/**
 * Parse the ADMIN_AUTH_IDS environment variable.
 * Returns an empty array if unset or empty.
 */
function parseAdminIds(): string[] {
  const raw = process.env.ADMIN_AUTH_IDS ?? "";
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}
