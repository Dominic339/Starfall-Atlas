/**
 * POST /api/game/alliance/create
 *
 * Founds a new alliance. The requesting player becomes the founder.
 *
 * Validation:
 *   1. Auth
 *   2. Input: name (3–40 chars), tag (2–5 alphanumeric chars)
 *   3. Player is not already in an alliance
 *   4. Alliance name and tag are not already taken
 *   5. Player has sufficient iron in station inventory (BALANCE.alliance.createCostIron)
 *
 * Inserts:
 *   - alliances row (name, tag, founder_id, invite_code auto-generated)
 *   - alliance_members row (role = 'founder')
 *   - Deducts iron from station inventory
 *
 * Body:   { name: string, tag: string }
 * Returns: { ok: true, data: { allianceId, name, tag, inviteCode } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";
import type { Alliance, PlayerStation } from "@/lib/types/game";

const CreateAllianceSchema = z.object({
  name: z.string().min(3).max(40),
  tag: z.string().regex(/^[A-Za-z0-9]{2,5}$/, "Tag must be 2–5 alphanumeric characters."),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(CreateAllianceSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { name, tag } = input.data;
  const tagUpper = tag.toUpperCase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Player must not already be in an alliance ─────────────────────────────
  const { data: existingMembership } = maybeSingleResult<{ id: string }>(
    await admin
      .from("alliance_members")
      .select("id")
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  if (existingMembership) {
    return toErrorResponse(
      fail("invalid_target", "You are already a member of an alliance. Leave it first.").error,
    );
  }

  // ── Name uniqueness ───────────────────────────────────────────────────────
  const { data: nameTaken } = maybeSingleResult<{ id: string }>(
    await admin
      .from("alliances")
      .select("id")
      .ilike("name", name)
      .maybeSingle(),
  );
  if (nameTaken) {
    return toErrorResponse(
      fail("invalid_target", "An alliance with that name already exists.").error,
    );
  }

  // ── Tag uniqueness ────────────────────────────────────────────────────────
  const { data: tagTaken } = maybeSingleResult<{ id: string }>(
    await admin
      .from("alliances")
      .select("id")
      .ilike("tag", tagUpper)
      .maybeSingle(),
  );
  if (tagTaken) {
    return toErrorResponse(
      fail("invalid_target", "An alliance with that tag already exists.").error,
    );
  }

  // ── Station and iron check ────────────────────────────────────────────────
  const { data: station } = maybeSingleResult<PlayerStation>(
    await admin
      .from("player_stations")
      .select("id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );
  if (!station) {
    // Station should always exist (created by bootstrap on first login).
    // If missing, the player likely logged in before migration 00016/00030
    // was applied, or the bootstrap reconciliation failed. Surfacing a
    // clear actionable message is better than a generic "not found".
    return toErrorResponse(
      fail(
        "not_found",
        "Your station could not be found. Please refresh the page — " +
          "bootstrap will create it automatically. If this persists, contact support.",
      ).error,
    );
  }

  const cost = BALANCE.alliance.createCostIron;
  const { data: ironRow } = maybeSingleResult<{ quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron")
      .maybeSingle(),
  );
  const ironAvailable = ironRow?.quantity ?? 0;
  if (ironAvailable < cost) {
    return toErrorResponse(
      fail(
        "insufficient_resources",
        `Not enough iron. Need ${cost}, have ${ironAvailable}.`,
      ).error,
    );
  }

  // ── Deduct iron ───────────────────────────────────────────────────────────
  const newIron = ironAvailable - cost;
  if (newIron <= 0) {
    await admin
      .from("resource_inventory")
      .delete()
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron");
  } else {
    await admin
      .from("resource_inventory")
      .update({ quantity: newIron })
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron");
  }

  // ── Create alliance ───────────────────────────────────────────────────────
  const { data: alliance } = maybeSingleResult<Alliance>(
    await admin
      .from("alliances")
      .insert({ name, tag: tagUpper, founder_id: player.id })
      .select("id, name, tag, invite_code")
      .maybeSingle(),
  );

  if (!alliance) {
    // Refund iron on failure
    await admin
      .from("resource_inventory")
      .upsert(
        { location_type: "station", location_id: station.id, resource_type: "iron", quantity: ironAvailable },
        { onConflict: "location_type,location_id,resource_type" },
      );
    return Response.json(
      { ok: false, error: { code: "internal_error", message: "Failed to create alliance." } },
      { status: 500 },
    );
  }

  // ── Add founder as member ─────────────────────────────────────────────────
  await admin
    .from("alliance_members")
    .insert({ alliance_id: alliance.id, player_id: player.id, role: "founder" });

  return Response.json({
    ok: true,
    data: {
      allianceId: alliance.id,
      name: alliance.name,
      tag: alliance.tag,
      inviteCode: alliance.invite_code,
    },
  });
}
