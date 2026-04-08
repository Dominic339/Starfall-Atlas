/**
 * POST /api/game/refine
 *
 * Refines raw resources in the player's station inventory into refined goods.
 * Supports: steel (iron + carbon), glass (silica), food (biomass + water).
 *
 * All writes are server-authoritative. Raw inputs are deducted FIRST (safe
 * failure order: lose inputs rather than duplicate outputs).
 *
 * Body:   { resourceType: 'steel' | 'glass' | 'food', amount: number }
 * Returns: { ok: true, data: { resourceType, amount, consumed } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { BALANCE } from "@/lib/config/balance";
import type { PlayerStation, ResourceInventoryRow } from "@/lib/types/game";

const REFINABLE = ["steel", "glass", "food"] as const;

const RefineSchema = z.object({
  resourceType: z.enum(REFINABLE),
  amount: z.number().int().min(1).max(10000),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(RefineSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { resourceType, amount } = input.data;

  const recipe = BALANCE.refining.recipes[resourceType];
  if (!recipe) {
    return toErrorResponse(fail("invalid_target", `No recipe for ${resourceType}.`).error);
  }

  const admin = createAdminClient();

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
    return toErrorResponse(fail("not_found", "Station not found — refresh the page to rebuild it automatically.").error);
  }

  // ── Fetch required input resource types ───────────────────────────────────
  const inputTypes = recipe.inputs.map((i) => i.resource_type);
  const { data: invRows } = listResult<Pick<ResourceInventoryRow, "resource_type" | "quantity">>(
    await admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .in("resource_type", inputTypes),
  );

  const inv = new Map((invRows ?? []).map((r) => [r.resource_type, r.quantity]));

  // ── Check availability ────────────────────────────────────────────────────
  for (const inp of recipe.inputs) {
    const needed = inp.quantity * amount;
    const available = inv.get(inp.resource_type) ?? 0;
    if (available < needed) {
      return toErrorResponse(
        fail(
          "insufficient_resources",
          `Not enough ${inp.resource_type}. Need ${needed}, have ${available}.`,
        ).error,
      );
    }
  }

  const outputAmount = recipe.outputPerBatch * amount;

  // ── Deduct inputs FIRST ───────────────────────────────────────────────────
  const consumed: { resource_type: string; quantity: number }[] = [];
  for (const inp of recipe.inputs) {
    const needed = inp.quantity * amount;
    const current = inv.get(inp.resource_type) ?? 0;
    const remaining = current - needed;
    consumed.push({ resource_type: inp.resource_type, quantity: needed });

    if (remaining <= 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("resource_inventory")
        .delete()
        .eq("location_type", "station")
        .eq("location_id", station.id)
        .eq("resource_type", inp.resource_type);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("resource_inventory")
        .update({ quantity: remaining })
        .eq("location_type", "station")
        .eq("location_id", station.id)
        .eq("resource_type", inp.resource_type);
    }
  }

  // ── Add output ────────────────────────────────────────────────────────────
  const { data: existingOutput } = maybeSingleResult<Pick<ResourceInventoryRow, "quantity">>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", resourceType)
      .maybeSingle(),
  );

  const currentOutput = existingOutput?.quantity ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("resource_inventory")
    .upsert(
      [{ location_type: "station", location_id: station.id, resource_type: resourceType, quantity: currentOutput + outputAmount }],
      { onConflict: "location_type,location_id,resource_type" },
    );

  return Response.json({
    ok: true,
    data: { resourceType, amount: outputAmount, consumed },
  });
}
