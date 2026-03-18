/**
 * Supabase Auth callback handler.
 *
 * Handles the redirect after:
 *   - Email confirmation links
 *   - Magic links
 *   - OAuth provider callbacks (future)
 *
 * The `code` query parameter is exchanged for a session via PKCE.
 * After a successful exchange the user is redirected to /game.
 * On failure, they are redirected to /login with an error message.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/game";

  if (code) {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Redirect to game (or the `next` param if provided by Supabase email templates).
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Exchange failed or no code present — send to login with error hint.
  return NextResponse.redirect(
    new URL("/login?error=auth_callback_failed", origin),
  );
}
