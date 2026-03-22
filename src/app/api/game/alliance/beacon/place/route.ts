/**
 * POST /api/game/alliance/beacon/place
 *
 * Places an alliance beacon on a catalog system.
 *
 * Validation:
 *   1. Auth
 *   2. Input: systemId (string)
 *   3. Player is in an alliance with role 'founder' or 'officer'
 *   4. System id is a valid alpha-catalog entry
 *   5. No active beacon from this alliance already exists in that system
 *   6. Alliance has not exceeded maxActiveBeacons
 *   7. Player has sufficient iron in station inventory (BALANCE.alliance.beaconPlaceCostIron)
 *
 * Body:   { systemId: string }
 * Returns: { ok: true, data: { beaconId, allianceId, systemId } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";
import { getCatalogEntry } from "@/lib/catalog";
import type { PlayerStation } from "@/lib/types/game";

const PlaceBeaconSchema = z.object({
  systemId: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(PlaceBeaconSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { systemId } = input.data;

  // ── Validate catalog system ───────────────────────────────────────────────
  const catalogEntry = getCatalogEntry(systemId);
  if (!catalogEntry) {
    return toErrorResponse(
      fail("not_found", `System '${systemId}' is not a known catalog system.`).error,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Player membership and role ────────────────────────────────────────────
  const { data: membership } = maybeSingleResult<{
    alliance_id: string;
    role: string;
  }>(
    await admin
      .from("alliance_members")
      .select("alliance_id, role")
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  if (!membership) {
    return toErrorResponse(fail("forbidden", "You are not in an alliance.").error);
  }
  if (membership.role !== "founder" && membership.role !== "officer") {
    return toErrorResponse(
      fail("forbidden", "Only alliance founders and officers may place beacons.").error,
    );
  }

  const { alliance_id } = membership;

  // ── Check for existing active beacon in this system ───────────────────────
  const { data: existing } = maybeSingleResult<{ id: string }>(
    await admin
      .from("alliance_beacons")
      .select("id")
      .eq("alliance_id", alliance_id)
      .eq("system_id", systemId)
      .eq("is_active", true)
      .maybeSingle(),
  );
  if (existing) {
    return toErrorResponse(
      fail("invalid_target", "Your alliance already has an active beacon in that system.").error,
    );
  }

  // ── Check active beacon cap ───────────────────────────────────────────────
  const { count: activeCount } = await admin
    .from("alliance_beacons")
    .select("id", { count: "exact", head: true })
    .eq("alliance_id", alliance_id)
    .eq("is_active", true);

  if ((activeCount ?? 0) >= BALANCE.alliance.maxActiveBeacons) {
    return toErrorResponse(
      fail(
        "invalid_target",
        `Alliance beacon limit reached (${BALANCE.alliance.maxActiveBeacons} active beacons maximum).`,
      ).error,
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
    return toErrorResponse(fail("not_found", "Station not found — refresh the page to rebuild it automatically.").error);
  }

  const cost = BALANCE.alliance.beaconPlaceCostIron;
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

  // ── Insert beacon ─────────────────────────────────────────────────────────
  const { data: beacon } = maybeSingleResult<{ id: string }>(
    await admin
      .from("alliance_beacons")
      .insert({
        alliance_id,
        system_id: systemId,
        placed_by: player.id,
        is_active: true,
      })
      .select("id")
      .maybeSingle(),
  );

  if (!beacon) {
    return Response.json(
      { ok: false, error: { code: "internal_error", message: "Failed to place beacon." } },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    data: { beaconId: beacon.id, allianceId: alliance_id, systemId },
  });
}
