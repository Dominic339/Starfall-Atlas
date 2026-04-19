/**
 * POST /api/game/alliance/goal/contribute
 *
 * Alliance member contributes resources from their station to an active goal.
 * Resources move to alliance_storage; member earns 1 alliance_credit per unit.
 * When quantity_filled reaches quantity_target the goal is marked completed.
 *
 * Body: { goalId: string, quantity: number }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const Schema = z.object({
  goalId:   z.string().uuid(),
  quantity: z.number().int().min(1),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { goalId, quantity } = input.data as { goalId: string; quantity: number };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Fetch membership ──────────────────────────────────────────────────────
  const { data: membership } = maybeSingleResult<{
    id: string;
    alliance_id: string;
    alliance_credits: number;
  }>(
    await admin
      .from("alliance_members")
      .select("id, alliance_id, alliance_credits")
      .eq("player_id", player.id)
      .maybeSingle(),
  );
  if (!membership) {
    return toErrorResponse(fail("forbidden", "You are not in an alliance.").error);
  }

  // ── Fetch and validate goal ───────────────────────────────────────────────
  type GoalRow = {
    id: string;
    alliance_id: string;
    resource_type: string;
    quantity_target: number;
    quantity_filled: number;
    completed_at: string | null;
    expired: boolean;
    deadline_at: string;
  };
  const { data: goal } = maybeSingleResult<GoalRow>(
    await admin.from("alliance_goals").select("*").eq("id", goalId).maybeSingle(),
  );
  if (!goal) return toErrorResponse(fail("not_found", "Goal not found.").error);
  if (goal.alliance_id !== membership.alliance_id) {
    return toErrorResponse(fail("forbidden", "Goal does not belong to your alliance.").error);
  }
  if (goal.completed_at !== null) {
    return toErrorResponse(fail("invalid_target", "Goal is already completed.").error);
  }
  if (goal.expired || new Date(goal.deadline_at) <= new Date()) {
    return toErrorResponse(fail("invalid_target", "Goal deadline has passed.").error);
  }

  const remaining = goal.quantity_target - goal.quantity_filled;
  if (remaining <= 0) {
    return toErrorResponse(fail("invalid_target", "Goal is already full.").error);
  }
  const actualQty = Math.min(quantity, remaining);

  // ── Fetch player station and resource ─────────────────────────────────────
  const { data: station } = maybeSingleResult<{ id: string }>(
    await admin.from("player_stations").select("id").eq("owner_id", player.id).maybeSingle(),
  );
  if (!station) {
    return toErrorResponse(fail("not_found", "Station not found.").error);
  }

  const { data: stationRow } = maybeSingleResult<{ quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", goal.resource_type)
      .maybeSingle(),
  );
  const stationQty = stationRow?.quantity ?? 0;
  if (stationQty < actualQty) {
    return toErrorResponse(
      fail(
        "insufficient_resources",
        `Need ${actualQty} ${goal.resource_type}, you have ${stationQty}.`,
      ).error,
    );
  }

  // ── Deduct from player station ────────────────────────────────────────────
  const newStationQty = stationQty - actualQty;
  if (newStationQty <= 0) {
    await admin
      .from("resource_inventory")
      .delete()
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", goal.resource_type);
  } else {
    await admin
      .from("resource_inventory")
      .update({ quantity: newStationQty })
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", goal.resource_type);
  }

  // ── Add to alliance storage ───────────────────────────────────────────────
  const { data: storageRow } = maybeSingleResult<{ quantity: number }>(
    await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "alliance_storage")
      .eq("location_id", membership.alliance_id)
      .eq("resource_type", goal.resource_type)
      .maybeSingle(),
  );
  const storageQty = storageRow?.quantity ?? 0;
  await admin
    .from("resource_inventory")
    .upsert(
      {
        location_type: "alliance_storage",
        location_id:   membership.alliance_id,
        resource_type: goal.resource_type,
        quantity:      storageQty + actualQty,
      },
      { onConflict: "location_type,location_id,resource_type" },
    );

  // ── Update goal progress ──────────────────────────────────────────────────
  const newFilled     = goal.quantity_filled + actualQty;
  const nowCompleted  = newFilled >= goal.quantity_target;
  await admin
    .from("alliance_goals")
    .update({
      quantity_filled: newFilled,
      ...(nowCompleted ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", goalId);

  // ── Earn alliance credits ─────────────────────────────────────────────────
  await admin
    .from("alliance_members")
    .update({ alliance_credits: membership.alliance_credits + actualQty })
    .eq("id", membership.id);

  // ── Record contribution ───────────────────────────────────────────────────
  await admin.from("alliance_goal_contributions").insert({
    goal_id:       goalId,
    player_id:     player.id,
    resource_type: goal.resource_type,
    quantity:      actualQty,
  });

  return Response.json({
    ok: true,
    data: {
      contributed:    actualQty,
      newFilled,
      goalCompleted:  nowCompleted,
      creditsEarned:  actualQty,
    },
  });
}
