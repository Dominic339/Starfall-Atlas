/**
 * POST /api/game/gate/reclaim
 *
 * Reclaims a neutral hyperspace gate. Only the current governance holder may
 * reclaim. Reclaim is faster than initial construction (6h vs 24h).
 *
 * Body: { systemId: string }
 * Returns: { ok: true, data: { gate, completeAt: string, jobCompleted: boolean } }
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
import type { HyperspaceGate, GateConstructionJob, Ship, PlayerStation } from "@/lib/types/game";

const ReclaimSchema = z.object({
  systemId: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(ReclaimSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { systemId } = input.data;

  if (systemId === SOL_SYSTEM_ID) {
    return toErrorResponse(fail("forbidden", "Sol cannot have a hyperspace gate.").error);
  }

  if (!getCatalogEntry(systemId)) {
    return toErrorResponse(fail("not_found", `System '${systemId}' not found.`).error);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now   = new Date();

  // ── Governance check ──────────────────────────────────────────────────────
  const { data: stewardship } = maybeSingleResult<{ steward_id: string; has_governance: boolean }>(
    await admin
      .from("system_stewardship")
      .select("steward_id, has_governance")
      .eq("system_id", systemId)
      .maybeSingle(),
  );

  if (!stewardship || stewardship.steward_id !== player.id || !stewardship.has_governance) {
    return toErrorResponse(
      fail("forbidden", "Only the governance holder of this system can reclaim a gate.").error,
    );
  }

  // ── Presence check ────────────────────────────────────────────────────────
  const [{ data: shipRows }, { data: stationRow }] = await Promise.all([
    listResult<Pick<Ship, "current_system_id">>(
      await admin.from("ships").select("current_system_id").eq("owner_id", player.id),
    ),
    maybeSingleResult<Pick<PlayerStation, "current_system_id">>(
      await admin.from("player_stations").select("current_system_id").eq("owner_id", player.id).maybeSingle(),
    ),
  ]);

  const shipPresent    = (shipRows ?? []).some((s) => s.current_system_id === systemId);
  const stationPresent = stationRow?.current_system_id === systemId;

  if (!shipPresent && !stationPresent) {
    return toErrorResponse(
      fail("invalid_target", "Your ship or station must be in the system to reclaim a gate.").error,
    );
  }

  // ── Gate check ────────────────────────────────────────────────────────────
  const { data: gate } = maybeSingleResult<HyperspaceGate>(
    await admin.from("hyperspace_gates").select("*").eq("system_id", systemId).maybeSingle(),
  );

  if (!gate) {
    return toErrorResponse(fail("not_found", "No gate exists in this system. Use build to construct one.").error);
  }
  if (gate.status === "active") {
    return toErrorResponse(fail("already_exists", "The gate is already active.").error);
  }
  if (gate.status === "inactive") {
    return toErrorResponse(fail("job_in_progress", "Gate is already under initial construction.").error);
  }

  // gate.status === "neutral"

  // Check if a reclaim job is already in progress
  const { data: existingJob } = maybeSingleResult<GateConstructionJob>(
    await admin
      .from("gate_construction_jobs")
      .select("*")
      .eq("gate_id", gate.id)
      .eq("status", "pending")
      .maybeSingle(),
  );

  if (existingJob) {
    if (new Date(existingJob.complete_at) <= now) {
      // Complete the reclaim now
      await admin
        .from("hyperspace_gates")
        .update({ status: "active", owner_id: player.id, reclaimed_at: now.toISOString() })
        .eq("id", gate.id);
      await admin.from("gate_construction_jobs").update({ status: "complete" }).eq("id", existingJob.id);
      void admin.from("world_events").insert({
        event_type: "gate_reclaimed",
        player_id: player.id,
        system_id: systemId,
        metadata: { handle: player.handle },
      });
      return Response.json({ ok: true, data: { gate: { ...gate, status: "active", owner_id: player.id }, completeAt: null, jobCompleted: true } });
    }
    return Response.json({ ok: true, data: { gate, completeAt: existingJob.complete_at, jobCompleted: false } });
  }

  // ── Start reclaim construction job ────────────────────────────────────────
  const completeAt = new Date(now.getTime() + BALANCE.gates.reclaimHours * 60 * 60 * 1000);

  // Pre-assign owner to this player (they're claiming it)
  await admin
    .from("hyperspace_gates")
    .update({ owner_id: player.id })
    .eq("id", gate.id);

  await admin.from("gate_construction_jobs").insert({
    gate_id:     gate.id,
    player_id:   player.id,
    started_at:  now.toISOString(),
    complete_at: completeAt.toISOString(),
    status:      "pending",
  });

  return Response.json({
    ok: true,
    data: { gate: { ...gate, owner_id: player.id }, completeAt: completeAt.toISOString(), jobCompleted: false },
  });
}
