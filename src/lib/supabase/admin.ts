/**
 * ⚠️  SERVICE-ROLE ADMIN CLIENT — SERVER-SIDE ONLY ⚠️
 *
 * This client bypasses Row-Level Security entirely.
 * NEVER import this in Client Components or expose it to the browser.
 * ONLY use it in:
 *   - Next.js Route Handlers (/api/game/*)
 *   - Server Actions
 *   - src/lib/actions/* after explicit authorization checks
 *
 * Authorization must be verified BEFORE calling any admin client method.
 * The admin client is for executing the action, not for checking permission.
 */

import { createClient } from "@supabase/supabase-js";

let _adminClient: ReturnType<typeof createClient> | null = null;

export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "[starfall] createAdminClient() called in a browser context. " +
        "This is a server-only utility.",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "[starfall] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY " +
        "is not set. Check your .env.local file.",
    );
  }

  // Reuse the singleton in non-edge environments for connection efficiency.
  // In Edge Runtime, a new client is created per request.
  if (!_adminClient) {
    _adminClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return _adminClient;
}
