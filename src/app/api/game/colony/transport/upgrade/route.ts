/**
 * POST /api/game/colony/transport/upgrade
 *
 * Upgrades the lowest-tier transport unit at a colony by one tier.
 * Cost is deducted from the player's station inventory.
 *
 * Design: upgrades the single lowest-tier transport row at the colony.
 * This keeps the model simple — the player doesn't select a specific transport.
 *
 * Body:   { colonyId: string }
 * Returns: { ok: true, data: { transportId: string, oldTier: number, newTier: number, totalCapacity: number } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { colonyTransportCapacity, transportUpgradeCost } from "@/lib/game/transportCapacity";
import type { Colony, ColonyTransport, PlayerStation } from "@/lib/types/game";

const UpgradeTransportSchema = z.object({
  colonyId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ────────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(UpgradeTransportSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { colonyId } = input.data;

  const admin = createAdminClient();

  // ── Verify colony ownership ───────────────────────────────────────────────
  const { data: colony } = maybeSingleResult<Pick<Colony, "id" | "owner_id" | "status">>(
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

  // ── Find lowest-tier upgradeable transport ────────────────────────────────
  const { data: transports } = listResult<Pick<ColonyTransport, "id" | "tier">>(
    await admin
      .from("colony_transports")
      .select("id, tier")
      .eq("colony_id", colonyId)
      .order("tier", { ascending: true }),
  );

  const rows = transports ?? [];
  if (rows.length === 0) {
    return toErrorResponse(
      fail("invalid_target", "No transports at this colony to upgrade.").error,
    );
  }

  // Pick the lowest-tier transport that can still be upgraded
  const target = rows.find((t) => t.tier < 5);
  if (!target) {
    return toErrorResponse(
      fail("invalid_target", "All transports are already at maximum tier (T5).").error,
    );
  }

  const oldTier = target.tier;
  const newTier = oldTier + 1;
  const cost = transportUpgradeCost(newTier);

  if (!cost) {
    return toErrorResponse(fail("internal_error", "Invalid upgrade tier.").error);
  }

  // ── Fetch player station ──────────────────────────────────────────────────
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

  // ── Fetch station resources ───────────────────────────────────────────────
  const { data: invRows } = listResult<{ resource_type: string; quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("resource_type, quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .in("resource_type", ["iron", "carbon", "steel"]),
  );

  const invMap = new Map((invRows ?? []).map((r) => [r.resource_type, r.quantity]));
  const ironAvail   = invMap.get("iron")   ?? 0;
  const carbonAvail = invMap.get("carbon") ?? 0;
  const steelAvail  = invMap.get("steel")  ?? 0;

  if (ironAvail < cost.iron) {
    return toErrorResponse(
      fail("insufficient_resources", `Not enough iron. Need ${cost.iron}, have ${ironAvail}.`).error,
    );
  }
  if (carbonAvail < cost.carbon) {
    return toErrorResponse(
      fail("insufficient_resources", `Not enough carbon. Need ${cost.carbon}, have ${carbonAvail}.`).error,
    );
  }
  if (steelAvail < cost.steel) {
    return toErrorResponse(
      fail("insufficient_resources", `Not enough steel. Need ${cost.steel}, have ${steelAvail}.`).error,
    );
  }

  // ── Deduct resources from station ─────────────────────────────────────────
  const updates: { resource_type: string; newQty: number }[] = [];
  if (cost.iron > 0)   updates.push({ resource_type: "iron",   newQty: ironAvail   - cost.iron   });
  if (cost.carbon > 0) updates.push({ resource_type: "carbon", newQty: carbonAvail - cost.carbon });
  if (cost.steel > 0)  updates.push({ resource_type: "steel",  newQty: steelAvail  - cost.steel  });

  for (const { resource_type, newQty } of updates) {
    if (newQty <= 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("resource_inventory")
        .delete()
        .eq("location_type", "station")
        .eq("location_id", station.id)
        .eq("resource_type", resource_type);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("resource_inventory")
        .update({ quantity: newQty })
        .eq("location_type", "station")
        .eq("location_id", station.id)
        .eq("resource_type", resource_type);
    }
  }

  // ── Upgrade transport tier ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("colony_transports")
    .update({ tier: newTier })
    .eq("id", target.id);

  // ── Return updated summary ────────────────────────────────────────────────
  const updatedTransports = rows.map((t) =>
    t.id === target.id ? { ...t, tier: newTier } : t,
  );
  const totalCapacity = colonyTransportCapacity(updatedTransports);

  return Response.json({
    ok: true,
    data: {
      transportId: target.id,
      oldTier,
      newTier,
      totalCapacity,
      count: updatedTransports.length,
    },
  });
}
