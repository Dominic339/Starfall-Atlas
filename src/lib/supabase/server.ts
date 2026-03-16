/**
 * Server-side Supabase client (SSR-safe).
 * Use in Server Components, Route Handlers, and Server Actions.
 * Reads/sets cookies for session management via @supabase/ssr.
 *
 * For game state WRITES, use the admin client (server.admin.ts)
 * after performing authorization checks.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll may be called from a Server Component where cookies
            // are read-only. The session will still be refreshed by middleware.
          }
        },
      },
    },
  );
}

/**
 * Convenience: get the authenticated user from the current session.
 * Returns null if not authenticated.
 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
