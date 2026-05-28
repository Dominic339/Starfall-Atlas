/**
 * GET /api/game/hero/panel
 * Returns the player's hero ship data for the Commander panel.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: hero } = await admin
    .from("ships")
    .select("id, name, hero_class, hero_level, hero_xp")
    .eq("owner_id", player.id)
    .eq("is_hero", true)
    .maybeSingle();

  if (!hero) {
    return Response.json({ ok: false, error: { code: "not_found", message: "No commander found." } }, { status: 404 });
  }

  return Response.json({
    ok: true,
    data: {
      shipId:    hero.id,
      shipName:  hero.name,
      heroClass: hero.hero_class ?? "pathfinder",
      heroLevel: hero.hero_level ?? 1,
      heroXp:    hero.hero_xp ?? 0,
    },
  });
}
