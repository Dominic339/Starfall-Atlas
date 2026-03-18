"use server";

/**
 * Sign-out server action.
 * Called from the game layout's sign-out form.
 * Clears the Supabase session and redirects to /login.
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
