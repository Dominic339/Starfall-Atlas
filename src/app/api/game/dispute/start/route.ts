/**
 * POST /api/game/dispute/start
 *
 * Opens a beacon dispute. Caller must be an officer or founder of an alliance
 * that is different from the beacon's alliance. The beacon must satisfy all
 * disputability conditions:
 *
 *   1. Beacon exists and is_active = true.
 *   2. Beacon does NOT belong to the caller's alliance (can't dispute your own).
 *   3. No other active dispute on this beacon.
 *   4. Beacon is NOT on cooldown.
 *   5. Beacon system is NOT inside a completed territory polygon of its alliance
 *      (only frontier/unprotected beacons are disputable — Phase 25 rule).
 *
 * On success: creates a dispute row with resolves_at = NOW() + 8 hours.
 *
 * Body:   { beaconId: string }
 * Returns: { ok: true, data: { disputeId, resolvesAt } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult, maybeSingleResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";
import { computeAllTerritories } from "@/lib/game/territory";
import { resolveOverdueDisputes } from "@/lib/game/disputeResolution";
import { getAllCatalogEntries } from "@/lib/catalog";

const StartDisputeSchema = z.object({
  beaconId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ─────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(StartDisputeSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { beaconId } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Lazy resolution pass ──────────────────────────────────────────────────
  await resolveOverdueDisputes(admin);

  // ── Caller must be in an alliance as officer or founder ───────────────────
  type MemberRow = { alliance_id: string; role: string };
  const { data: membership } = maybeSingleResult<MemberRow>(
    await admin
      .from("alliance_members")
      .select("alliance_id, role")
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  if (!membership) {
    return toErrorResponse(fail("forbidden", "You are not in an alliance.").error);
  }
  if (membership.role === "member") {
    return toErrorResponse(
      fail("forbidden", "Only officers and founders can open disputes.").error,
    );
  }

  const callerAllianceId = membership.alliance_id;

  // ── Fetch target beacon ───────────────────────────────────────────────────
  type BeaconRow = {
    id: string;
    alliance_id: string;
    system_id: string;
    is_active: boolean;
  };
  const { data: beacon } = maybeSingleResult<BeaconRow>(
    await admin
      .from("alliance_beacons")
      .select("id, alliance_id, system_id, is_active")
      .eq("id", beaconId)
      .maybeSingle(),
  );

  if (!beacon || !beacon.is_active) {
    return toErrorResponse(fail("not_found", "Beacon not found or not active.").error);
  }
  if (beacon.alliance_id === callerAllianceId) {
    return toErrorResponse(
      fail("invalid_target", "You cannot dispute your own alliance's beacon.").error,
    );
  }

  // ── Check for existing active dispute ─────────────────────────────────────
  type DisputeExistsRow = { id: string };
  const { data: existingDispute } = maybeSingleResult<DisputeExistsRow>(
    await admin
      .from("disputes")
      .select("id")
      .eq("beacon_id", beaconId)
      .eq("status", "open")
      .maybeSingle(),
  );

  if (existingDispute) {
    return toErrorResponse(
      fail("already_exists", "This beacon already has an active dispute.").error,
    );
  }

  // ── Check beacon cooldown ─────────────────────────────────────────────────
  const now = new Date();
  type CooldownRow = { id: string; expires_at: string };
  const { data: cooldown } = maybeSingleResult<CooldownRow>(
    await admin
      .from("beacon_cooldowns")
      .select("id, expires_at")
      .eq("beacon_id", beaconId)
      .gt("expires_at", now.toISOString())
      .maybeSingle(),
  );

  if (cooldown) {
    const expiresAt = new Date(cooldown.expires_at);
    const hoursLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60));
    return toErrorResponse(
      fail(
        "invalid_target",
        `This beacon is on cooldown for another ~${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}.`,
      ).error,
    );
  }

  // ── Check disputability: beacon must NOT be safely inside a territory ─────
  // Fetch all active beacons for the defending alliance
  type AllBeaconRow = { id: string; alliance_id: string; system_id: string };
  const { data: defendingBeacons } = listResult<AllBeaconRow>(
    await admin
      .from("alliance_beacons")
      .select("id, alliance_id, system_id")
      .eq("alliance_id", beacon.alliance_id)
      .eq("is_active", true),
  );

  const allDefendingBeacons = defendingBeacons ?? [];

  // Build catalog data
  const catalog = getAllCatalogEntries();
  const catalogBySystem = new Map(catalog.map((e) => [e.id, { x: e.x, y: e.y }]));
  const allSystems = catalog.map((e) => ({ systemId: e.id, x: e.x, y: e.y }));

  // Fetch defending alliance tag/name for territory computation
  type AllianceRow = { id: string; name: string; tag: string };
  const { data: defendingAlliance } = maybeSingleResult<AllianceRow>(
    await admin
      .from("alliances")
      .select("id, name, tag")
      .eq("id", beacon.alliance_id)
      .maybeSingle(),
  );

  if (defendingAlliance) {
    const allianceMap = new Map([
      [beacon.alliance_id, { name: defendingAlliance.name, tag: defendingAlliance.tag }],
    ]);

    const territoryResults = computeAllTerritories({
      beacons: allDefendingBeacons.map((b) => ({
        id: b.id,
        allianceId: b.alliance_id,
        systemId: b.system_id,
      })),
      alliances: allianceMap,
      catalogBySystem,
      allSystems,
      maxLinkDist: BALANCE.alliance.beaconLinkMaxDistanceLy,
    });

    const territory = territoryResults[0];
    if (territory?.hasValidTerritory) {
      // If the beacon's system is inside the territory polygon, it is protected
      if (territory.systemsInTerritory.includes(beacon.system_id)) {
        return toErrorResponse(
          fail(
            "invalid_target",
            "This beacon is safely inside a completed territory and cannot be disputed.",
          ).error,
        );
      }
    }
  }

  // ── Create the dispute ────────────────────────────────────────────────────
  const resolvesAt = new Date(
    now.getTime() + BALANCE.disputes.windowHours * 60 * 60 * 1000,
  );

  type NewDisputeRow = { id: string; resolves_at: string };
  const { data: newDispute } = maybeSingleResult<NewDisputeRow>(
    await admin
      .from("disputes")
      .insert({
        beacon_id:             beaconId,
        defending_alliance_id: beacon.alliance_id,
        attacking_alliance_id: callerAllianceId,
        status:                "open",
        opened_at:             now.toISOString(),
        resolves_at:           resolvesAt.toISOString(),
      })
      .select("id, resolves_at")
      .single(),
  );

  if (!newDispute) {
    return toErrorResponse(fail("internal_error", "Failed to create dispute.").error);
  }

  return Response.json({
    ok: true,
    data: {
      disputeId:  newDispute.id,
      resolvesAt: newDispute.resolves_at,
    },
  });
}
