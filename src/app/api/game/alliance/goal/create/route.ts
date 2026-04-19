/**
 * POST /api/game/alliance/goal/create
 *
 * Officer or founder creates a new resource-collection goal for the alliance.
 *
 * Body: {
 *   title: string          — 3–60 chars
 *   resourceType: string   — any valid resource slug
 *   quantityTarget: number — units needed (> 0)
 *   creditReward: number   — alliance credits awarded proportionally on completion (≥ 0)
 *   deadlineHours: number  — hours until goal expires (1–720)
 * }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";

const Schema = z.object({
  title:          z.string().min(3).max(60),
  resourceType:   z.string().min(1).max(40),
  quantityTarget: z.number().int().min(1),
  creditReward:   z.number().int().min(0),
  deadlineHours:  z.number().int().min(1).max(720),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(Schema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { title, resourceType, quantityTarget, creditReward, deadlineHours } = input.data as {
    title: string;
    resourceType: string;
    quantityTarget: number;
    creditReward: number;
    deadlineHours: number;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Verify alliance membership (officer or founder only) ──────────────────
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
  if (membership.role === "member") {
    return toErrorResponse(
      fail("forbidden", "Only officers and founders can create alliance goals.").error,
    );
  }

  // ── Insert goal ───────────────────────────────────────────────────────────
  const deadlineAt = new Date(Date.now() + deadlineHours * 3_600_000).toISOString();

  const { data: goalRow } = await admin
    .from("alliance_goals")
    .insert({
      alliance_id:     membership.alliance_id,
      created_by:      player.id,
      title,
      resource_type:   resourceType,
      quantity_target: quantityTarget,
      quantity_filled: 0,
      credit_reward:   creditReward,
      deadline_at:     deadlineAt,
    })
    .select("id")
    .single();

  return Response.json({
    ok: true,
    data: { goalId: (goalRow as { id: string }).id, deadlineAt },
  });
}
