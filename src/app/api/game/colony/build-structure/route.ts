/**
 * POST /api/game/colony/build-structure
 *
 * Builds or upgrades a colony structure. Costs are resource-based (iron + carbon)
 * deducted from the player's station inventory. Construction is instantaneous
 * in Phase 14 (no construction job).
 *
 * Supported types in Phase 14: warehouse, extractor, habitat_module.
 * Each colony may have at most one structure of each type (enforced by DB constraint).
 * Maximum tier: 3.
 *
 * Body:   { colonyId: string, structureType: string }
 * Returns: { ok: true, data: { structureId: string, type: string, tier: number } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { structureBuildCost } from "@/lib/game/colonyStructures";
import { BALANCE } from "@/lib/config/balance";
import type { Colony, Structure, ResourceInventoryRow, PlayerStation } from "@/lib/types/game";

const BUILDABLE_TYPES = ["warehouse", "extractor", "habitat_module"] as const;
type BuildableType = (typeof BUILDABLE_TYPES)[number];

const BuildStructureSchema = z.object({
  colonyId: z.string().uuid(),
  structureType: z.enum(BUILDABLE_TYPES),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(BuildStructureSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { colonyId, structureType } = input.data;

  const admin = createAdminClient();

  // ── Fetch colony ─────────────────────────────────────────────────────────
  const { data: colony } = maybeSingleResult<Colony>(
    await admin
      .from("colonies")
      .select("id, owner_id, status")
      .eq("id", colonyId)
      .maybeSingle(),
  );

  if (!colony) {
    return toErrorResponse(fail("not_found", "Colony not found.").error);
  }
  if (colony.owner_id !== player.id) {
    return toErrorResponse(fail("forbidden", "You do not own this colony.").error);
  }
  if (colony.status !== "active") {
    return toErrorResponse(fail("invalid_target", "Colony must be active to build structures.").error);
  }

  // ── Check existing structure ──────────────────────────────────────────────
  const { data: existing } = maybeSingleResult<Structure>(
    await admin
      .from("structures")
      .select("id, tier, is_active")
      .eq("colony_id", colonyId)
      .eq("type", structureType)
      .maybeSingle(),
  );

  const currentTier = existing?.tier ?? 0;
  const targetTier = currentTier + 1;

  if (targetTier > BALANCE.structures.maxTier) {
    return toErrorResponse(
      fail("invalid_target", `Structure is already at maximum tier (${BALANCE.structures.maxTier}).`).error,
    );
  }

  // ── Compute cost ──────────────────────────────────────────────────────────
  let cost: { iron: number; carbon: number };
  try {
    cost = structureBuildCost(targetTier);
  } catch {
    return toErrorResponse(fail("invalid_target", "Invalid target tier.").error);
  }

  // ── Fetch station ─────────────────────────────────────────────────────────
  const { data: station } = maybeSingleResult<PlayerStation>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("player_stations")
      .select("id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );

  if (!station) {
    return toErrorResponse(fail("not_found", "Player station not found.").error);
  }

  // ── Fetch station iron and carbon ──────────────────────────────────────────
  const { data: invRows } = listResult<Pick<ResourceInventoryRow, "resource_type" | "quantity">>(
    await admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .in("resource_type", ["iron", "carbon"]),
  );

  const invMap = new Map((invRows ?? []).map((r) => [r.resource_type, r.quantity]));
  const stationIron = invMap.get("iron") ?? 0;
  const stationCarbon = invMap.get("carbon") ?? 0;

  if (stationIron < cost.iron) {
    return toErrorResponse(
      fail(
        "insufficient_resources",
        `Not enough iron. Need ${cost.iron}, have ${stationIron}.`,
      ).error,
    );
  }
  if (stationCarbon < cost.carbon) {
    return toErrorResponse(
      fail(
        "insufficient_resources",
        `Not enough carbon. Need ${cost.carbon}, have ${stationCarbon}.`,
      ).error,
    );
  }

  const now = new Date().toISOString();

  // ── Deduct resources from station ─────────────────────────────────────────
  const newIron = stationIron - cost.iron;
  const newCarbon = stationCarbon - cost.carbon;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("resource_inventory")
    .upsert(
      [
        {
          location_type: "station",
          location_id: station.id,
          resource_type: "iron",
          quantity: newIron,
        },
        {
          location_type: "station",
          location_id: station.id,
          resource_type: "carbon",
          quantity: newCarbon,
        },
      ].filter((r) => r.quantity > 0),
      { onConflict: "location_type,location_id,resource_type" },
    );

  // Remove entries that dropped to 0
  for (const [rt, qty] of [["iron", newIron], ["carbon", newCarbon]] as [string, number][]) {
    if (qty <= 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("resource_inventory")
        .delete()
        .eq("location_type", "station")
        .eq("location_id", station.id)
        .eq("resource_type", rt);
    }
  }

  // ── Build or upgrade the structure ────────────────────────────────────────
  let structureId: string;

  if (existing) {
    // Upgrade: bump tier
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("structures")
      .update({ tier: targetTier, is_active: true, built_at: now, updated_at: now })
      .eq("id", existing.id);
    structureId = existing.id;
  } else {
    // New build: insert row
    const { data: inserted } = maybeSingleResult<{ id: string }>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("structures")
        .insert({
          colony_id: colonyId,
          owner_id: player.id,
          type: structureType as BuildableType,
          tier: targetTier,
          is_active: true,
          built_at: now,
        })
        .select("id")
        .maybeSingle(),
    );
    if (!inserted) {
      return toErrorResponse(fail("internal_error", "Failed to create structure.").error);
    }
    structureId = inserted.id;
  }

  return Response.json({
    ok: true,
    data: { structureId, type: structureType, tier: targetTier },
  });
}
