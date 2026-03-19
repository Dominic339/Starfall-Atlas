/**
 * Browser-side Supabase client.
 * Use in Client Components only.
 * For game state: READ-ONLY. All writes go through the API layer.
 */

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
