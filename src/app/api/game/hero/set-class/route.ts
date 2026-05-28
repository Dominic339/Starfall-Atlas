/**
 * POST /api/game/hero/set-class
 *
 * Set or change the player's hero ship class.
 * Can be changed freely while hero_xp = 0 (no XP invested).
 * Once any XP has been earned, class is locked until a reset item is used.
 *
 * Body: { heroClass: string }
 * Returns: { ok: true, data: { heroClass, heroLevel, heroXp } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { HeroClass } from "@/lib/game/heroShip";

const HERO_CLASSES: HeroClass[] = ["pathfinder", "warlord", "merchant", "industrialist", "engineer", "raider"];

const Schema = z.object({
  heroClass: z.enum(["pathfinder", "warlord", "merchant", "industrialist", "engineer", "raider"]),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const parsed = await parseInput(request, Schema);
  if (!parsed.ok) return toErrorResponse(parsed.error);
  const { heroClass } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Fetch the player's hero ship
  const { data: hero } = await admin
    .from("ships")
    .select("id, hero_xp, hero_class")
    .eq("owner_id", player.id)
    .eq("is_hero", true)
    .maybeSingle();

  if (!hero) {
    return Response.json({ ok: false, error: { code: "not_found", message: "No commander found." } }, { status: 404 });
  }

  // Lock class change once XP is invested (> 0 XP earned)
  if ((hero.hero_xp ?? 0) > 0 && hero.hero_class !== heroClass) {
    return Response.json({
      ok: false,
      error: { code: "locked", message: "Commander class is locked once XP has been earned." },
    }, { status: 400 });
  }

  await admin
    .from("ships")
    .update({ hero_class: heroClass })
    .eq("id", hero.id);

  return Response.json({
    ok: true,
    data: { heroClass, heroLevel: hero.hero_level ?? 1, heroXp: hero.hero_xp ?? 0 },
  });
}

export { HERO_CLASSES };
