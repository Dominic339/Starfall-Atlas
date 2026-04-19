/**
 * POST /api/game/premium/warp-tunnel
 *
 * Consumes an Unstable Warp Tunnel entitlement to create a temporary
 * one-way hyperspace lane from the player's current system to any
 * discovered system, ignoring range limits. No gate required.
 *
 * Body: { entitlementId: string, toSystemId: string }
 * Returns: { ok: true, data: { lane, expiresAt: string } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";
import { BALANCE } from "@/lib/config/balance";
import type { Ship, PlayerStation, SystemDiscovery, HyperspaceLane } from "@/lib/types/game";

const Schema = z.object({
  entitlementId: z.string().uuid(),
  toSystemId:    z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { entitlementId, toSystemId } = input.data;

  if (toSystemId === SOL_SYSTEM_ID) {
    return toErrorResponse(fail("forbidden", "Warp tunnels cannot target Sol.").error);
  }
  if (!getCatalogEntry(toSystemId)) {
    return toErrorResponse(fail("not_found", `System '${toSystemId}' not found.`).error);
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
  if (entitlement.item_type !== "unstable_warp_tunnel") {
    return toErrorResponse(fail("invalid_target", "This entitlement is not an Unstable Warp Tunnel.").error);
  }
  if (entitlement.consumed) {
    return toErrorResponse(fail("already_exists", "This warp tunnel has already been used.").error);
  }

  // ── Determine player's current system ─────────────────────────────────────
  const { data: shipRow } = maybeSingleResult<Pick<Ship, "current_system_id">>(
    await admin
      .from("ships")
      .select("current_system_id")
      .eq("owner_id", player.id)
      .not("current_system_id", "is", null)
      .maybeSingle(),
  );
  const { data: stationRow } = maybeSingleResult<Pick<PlayerStation, "current_system_id">>(
    await admin.from("player_stations").select("current_system_id").eq("owner_id", player.id).maybeSingle(),
  );
  const fromSystemId = shipRow?.current_system_id ?? stationRow?.current_system_id ?? null;
  if (!fromSystemId) {
    return toErrorResponse(fail("invalid_target", "No ship or station is present in a system.").error);
  }
  if (fromSystemId === toSystemId) {
    return toErrorResponse(fail("validation_error", "Source and destination are the same system.").error);
  }
  if (fromSystemId === SOL_SYSTEM_ID) {
    return toErrorResponse(fail("forbidden", "Warp tunnels cannot originate from Sol.").error);
  }

  // ── Target must be discovered ──────────────────────────────────────────────
  const { data: discovery } = maybeSingleResult<SystemDiscovery>(
    await admin
      .from("system_discoveries")
      .select("id")
      .eq("system_id", toSystemId)
      .limit(1)
      .maybeSingle(),
  );
  if (!discovery) {
    return toErrorResponse(fail("invalid_target", "The target system has not yet been discovered.").error);
  }

  // ── No existing active lane in this direction ─────────────────────────────
  const { data: existing } = await admin
    .from("hyperspace_lanes")
    .select("id, is_active")
    .eq("from_system_id", fromSystemId)
    .eq("to_system_id", toSystemId)
    .eq("is_active", true)
    .maybeSingle();
  if (existing) {
    return toErrorResponse(fail("already_exists", "An active lane already exists from your system to that destination.").error);
  }

  // ── Create lane + consume entitlement ─────────────────────────────────────
  const now      = new Date();
  const expiresAt = new Date(now.getTime() + BALANCE.lanes.warpTunnelExpiryHours * 3_600_000);

  const { data: lane } = maybeSingleResult<HyperspaceLane>(
    await admin
      .from("hyperspace_lanes")
      .insert({
        owner_id:         player.id,
        from_system_id:   fromSystemId,
        to_system_id:     toSystemId,
        from_gate_id:     null,
        to_gate_id:       null,
        access_level:     "public",
        transit_tax_rate: 0,
        is_active:        true,
        built_at:         now.toISOString(),
        expires_at:       expiresAt.toISOString(),
        is_one_way:       true,
      })
      .select("*")
      .maybeSingle(),
  );

  if (!lane) {
    return toErrorResponse(fail("internal_error", "Failed to create warp tunnel.").error);
  }

  await admin
    .from("premium_entitlements")
    .update({ consumed: true, consumed_at: now.toISOString() })
    .eq("id", entitlementId);

  return Response.json({ ok: true, data: { lane, expiresAt: expiresAt.toISOString() } });
}
