/**
 * POST /api/game/premium/wormhole
 *
 * Consumes a Stabilized Wormhole entitlement to create a persistent
 * two-way hyperspace lane between two player-governed systems.
 * No gate required at the far endpoint.
 * Counts against the lane cap (BALANCE.lanes.maxOwnedLanes).
 *
 * "Governed" means: the player holds active majority control or stewardship
 * with governance in the source system. Only source system requires governance.
 *
 * Body: { entitlementId: string, fromSystemId: string, toSystemId: string }
 * Returns: { ok: true, data: { lanes: [HyperspaceLane, HyperspaceLane] } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";
import { BALANCE } from "@/lib/config/balance";
import type { HyperspaceLane, SystemDiscovery } from "@/lib/types/game";

const Schema = z.object({
  entitlementId: z.string().uuid(),
  fromSystemId:  z.string().min(1).max(64),
  toSystemId:    z.string().min(1).max(64),
});

async function playerGovernsSystem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  playerId: string,
  systemId: string,
): Promise<boolean> {
  // Majority control and stewardship fetched in parallel
  const [mcRes, ssRes] = await Promise.all([
    admin.from("system_majority_control").select("controller_id").eq("system_id", systemId).eq("is_confirmed", true).maybeSingle(),
    admin.from("system_stewardship").select("steward_id, has_governance").eq("system_id", systemId).maybeSingle(),
  ]);
  if ((mcRes.data as { controller_id: string } | null)?.controller_id === playerId) return true;
  const ss = ssRes.data as { steward_id: string; has_governance: boolean } | null;
  return ss?.steward_id === playerId && !!ss?.has_governance;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { entitlementId, fromSystemId, toSystemId } = input.data;

  if (fromSystemId === toSystemId) {
    return toErrorResponse(fail("validation_error", "Source and destination must be different systems.").error);
  }
  for (const sysId of [fromSystemId, toSystemId]) {
    if (sysId === SOL_SYSTEM_ID) {
      return toErrorResponse(fail("forbidden", "Sol does not support wormholes.").error);
    }
    if (!getCatalogEntry(sysId)) {
      return toErrorResponse(fail("not_found", `System '${sysId}' not found.`).error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Validate entitlement ──────────────────────────────────────────────────
  const { data: entitlement } = maybeSingleResult<{
    id: string; player_id: string; item_type: string; consumed: boolean;
  }>(
    await admin
      .from("premium_entitlements")
      .select("id, player_id, item_type, consumed")
      .eq("id", entitlementId)
      .maybeSingle(),
  );
  if (!entitlement || entitlement.player_id !== player.id) {
    return toErrorResponse(fail("not_found", "Entitlement not found.").error);
  }
  if (entitlement.item_type !== "stabilized_wormhole") {
    return toErrorResponse(fail("invalid_target", "This entitlement is not a Stabilized Wormhole.").error);
  }
  if (entitlement.consumed) {
    return toErrorResponse(fail("already_exists", "This wormhole has already been used.").error);
  }

  // ── Parallel validation batch ─────────────────────────────────────────────
  // Discovery checks for both systems, governance, lane cap, existing lane — all at once.
  const [fromDiscRes, toDiscRes, governs, ownedLanesRes, existingLanesRes] = await Promise.all([
    admin.from("system_discoveries").select("id").eq("system_id", fromSystemId).limit(1).maybeSingle(),
    admin.from("system_discoveries").select("id").eq("system_id", toSystemId).limit(1).maybeSingle(),
    playerGovernsSystem(admin, player.id, fromSystemId),
    admin.from("hyperspace_lanes").select("id", { count: "exact" }).eq("owner_id", player.id).eq("is_active", true),
    admin.from("hyperspace_lanes").select("id").or(
      `and(from_system_id.eq.${fromSystemId},to_system_id.eq.${toSystemId}),` +
      `and(from_system_id.eq.${toSystemId},to_system_id.eq.${fromSystemId})`,
    ).eq("is_active", true),
  ]);

  if (!maybeSingleResult<SystemDiscovery>(fromDiscRes).data) {
    return toErrorResponse(fail("invalid_target", `System '${fromSystemId}' has not been discovered.`).error);
  }
  if (!maybeSingleResult<SystemDiscovery>(toDiscRes).data) {
    return toErrorResponse(fail("invalid_target", `System '${toSystemId}' has not been discovered.`).error);
  }
  if (!governs) {
    return toErrorResponse(
      fail("forbidden", "You must hold governance (stewardship or majority control) in the source system.").error,
    );
  }
  const ownedLanes = listResult<{ id: string }>(ownedLanesRes).data ?? [];
  if (ownedLanes.length + 2 > BALANCE.lanes.maxOwnedLanes) {
    return toErrorResponse(
      fail("capacity_exceeded", `Lane cap reached (max ${BALANCE.lanes.maxOwnedLanes} active lanes).`).error,
    );
  }
  if ((existingLanesRes.data ?? []).length > 0) {
    return toErrorResponse(fail("already_exists", "An active lane already connects these systems.").error);
  }

  // ── Create two-way lane pair + consume entitlement ────────────────────────
  const now = new Date();
  const laneBase = {
    owner_id:         player.id,
    access_level:     "public",
    transit_tax_rate: 0,
    is_active:        true,
    built_at:         now.toISOString(),
    from_gate_id:     null,
    to_gate_id:       null,
    expires_at:       null,
    is_one_way:       false,
  };

  const [laneABRes, laneBARes] = await Promise.all([
    admin.from("hyperspace_lanes").insert({ ...laneBase, from_system_id: fromSystemId, to_system_id: toSystemId }).select("*").maybeSingle(),
    admin.from("hyperspace_lanes").insert({ ...laneBase, from_system_id: toSystemId, to_system_id: fromSystemId }).select("*").maybeSingle(),
  ]);
  const { data: laneAB } = maybeSingleResult<HyperspaceLane>(laneABRes);
  const { data: laneBA } = maybeSingleResult<HyperspaceLane>(laneBARes);

  if (!laneAB || !laneBA) {
    return toErrorResponse(fail("internal_error", "Failed to create wormhole lanes.").error);
  }

  await admin
    .from("premium_entitlements")
    .update({ consumed: true, consumed_at: now.toISOString() })
    .eq("id", entitlementId);

  return Response.json({ ok: true, data: { lanes: [laneAB, laneBA] } });
}
