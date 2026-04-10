/**
 * POST /api/game/research/purchase
 *
 * Unlocks a research entry for the authenticated player.
 *
 * Validation order:
 *   1. Auth
 *   2. Input validation (researchId is a known definition)
 *   3. Not already unlocked
 *   4. Prerequisites met (other research IDs)
 *   5. Milestone conditions met (active colonies, discoveries, colony tier)
 *   6. Sufficient station resources
 *   7. Deduct resources, persist unlock
 *
 * Resources are deducted from the player's station inventory. The deduction
 * happens before the INSERT to ensure we never grant a research that wasn't
 * paid for (safer failure mode: player loses resources but doesn't unlock vs
 * double-unlocking).
 *
 * Body:   { researchId: string }
 * Returns: { ok: true, data: { researchId: string } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import {
  RESEARCH_BY_ID,
} from "@/lib/config/research";
import {
  arePrerequisitesMet,
  areMilestonesMet,
  type MilestoneData,
} from "@/lib/game/researchHelpers";
import type { PlayerResearch, PlayerStation, ResourceInventoryRow } from "@/lib/types/game";

const PurchaseSchema = z.object({
  researchId: z.string().min(1).max(128),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(PurchaseSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { researchId } = input.data;

  // ── Research definition ──────────────────────────────────────────────────
  const def = RESEARCH_BY_ID.get(researchId);
  if (!def) {
    return toErrorResponse(
      fail("not_found", `Unknown research: ${researchId}`).error,
    );
  }

  const admin = createAdminClient();

  // ── Scaffold-only entries are not yet purchasable ───────────────────────
  if (def.scaffoldOnly) {
    return toErrorResponse(
      fail(
        "invalid_target",
        "This research has no active gameplay effect yet and cannot be purchased.",
      ).error,
    );
  }

  // ── Already unlocked? ────────────────────────────────────────────────────
  const { data: existingRows } = listResult<Pick<PlayerResearch, "research_id">>(
    await admin
      .from("player_research")
      .select("research_id")
      .eq("player_id", player.id),
  );

  const unlockedIds = new Set((existingRows ?? []).map((r) => r.research_id));

  if (unlockedIds.has(researchId)) {
    return toErrorResponse(
      fail("already_exists", "This research is already unlocked.").error,
    );
  }

  // ── Prerequisites ────────────────────────────────────────────────────────
  if (!arePrerequisitesMet(def, unlockedIds)) {
    const missing = def.requires.filter((id) => !unlockedIds.has(id));
    return toErrorResponse(
      fail(
        "invalid_target",
        `Missing prerequisites: ${missing.join(", ")}`,
      ).error,
    );
  }

  // ── Milestones ───────────────────────────────────────────────────────────
  if (def.milestones && def.milestones.length > 0) {
    // Fetch milestone data in parallel.
    const [coloniesRes, discoveriesRes] = await Promise.all([
      admin
        .from("colonies")
        .select("population_tier")
        .eq("owner_id", player.id)
        .eq("status", "active"),
      admin
        .from("system_discoveries")
        .select("id")
        .eq("player_id", player.id),
    ]);

    const activeColonies = (coloniesRes.data ?? []) as { population_tier: number }[];
    const discoveriesCount = (discoveriesRes.data ?? []).length;
    const maxTier = activeColonies.reduce(
      (max, c) => Math.max(max, c.population_tier),
      0,
    );

    const milestoneData: MilestoneData = {
      activeColonyCount: activeColonies.length,
      systemsDiscovered: discoveriesCount,
      maxColonyTier: maxTier,
    };

    if (!areMilestonesMet(def.milestones, milestoneData)) {
      return toErrorResponse(
        fail(
          "invalid_target",
          "You have not met the required milestone conditions for this research.",
        ).error,
      );
    }
  }

  // ── Resource check ────────────────────────────────────────────────────────
  // Only proceed if the research has a cost.
  if (def.cost.length > 0) {
    // Fetch station.
    const { data: station } = maybeSingleResult<PlayerStation>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("player_stations")
        .select("id")
        .eq("owner_id", player.id)
        .maybeSingle(),
    );

    if (!station) {
      return toErrorResponse(
        fail("not_found", "Station not found — refresh the page to rebuild it automatically.").error,
      );
    }

    const resourceTypes = def.cost.map((c) => c.resource_type);
    const { data: invRows } = listResult<Pick<ResourceInventoryRow, "resource_type" | "quantity">>(
      await admin
        .from("resource_inventory")
        .select("resource_type, quantity")
        .eq("location_type", "station")
        .eq("location_id", station.id)
        .in("resource_type", resourceTypes),
    );

    const invMap = new Map(
      (invRows ?? []).map((r) => [r.resource_type, r.quantity]),
    );

    // Check each cost line.
    for (const costItem of def.cost) {
      const have = invMap.get(costItem.resource_type) ?? 0;
      if (have < costItem.quantity) {
        return toErrorResponse(
          fail(
            "insufficient_resources",
            `Not enough ${costItem.resource_type}. Need ${costItem.quantity}, have ${have}.`,
          ).error,
        );
      }
    }

    // ── Deduct resources (BEFORE inserting unlock) ──────────────────────────
    for (const costItem of def.cost) {
      const current = invMap.get(costItem.resource_type) ?? 0;
      const remaining = current - costItem.quantity;
      if (remaining <= 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any)
          .from("resource_inventory")
          .delete()
          .eq("location_type", "station")
          .eq("location_id", station.id)
          .eq("resource_type", costItem.resource_type);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any)
          .from("resource_inventory")
          .update({ quantity: remaining })
          .eq("location_type", "station")
          .eq("location_id", station.id)
          .eq("resource_type", costItem.resource_type);
      }
    }
  }

  // ── Persist unlock ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("player_research")
    .insert({ player_id: player.id, research_id: researchId });

  return Response.json({ ok: true, data: { researchId } });
}
