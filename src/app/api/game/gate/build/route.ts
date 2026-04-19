/**
 * POST /api/game/gate/build
 *
 * Initiates hyperspace gate construction for the current governance holder.
 * Gates are resolved lazily: if construction_jobs.complete_at ≤ now when this
 * route is called after construction started, the gate activates immediately.
 *
 * Rules:
 *   1. Player must be the system steward with governance (has_governance = true).
 *   2. System cannot be Sol (shared starter system, no gates allowed).
 *   3. Player's ship or station must be in the system.
 *   4. No existing active gate in this system.
 *   5. If gate exists but is neutral, returns an error directing to /reclaim.
 *   6. If gate under construction and job is complete → activates now.
 *
 * Body: { systemId: string }
 * Returns: { ok: true, data: { gate, jobCompleted: boolean, completeAt: string | null } }
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

const BuildSchema = z.object({
  systemId: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await request.json().catch(() => ({}));
  const input = parseInput(BuildSchema, body);
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
      fail("forbidden", "Only the governance holder of this system can build a gate.").error,
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
      fail("invalid_target", "Your ship or station must be in the system to build a gate.").error,
    );
  }

  // ── Check existing gate ───────────────────────────────────────────────────
  const { data: existingGate } = maybeSingleResult<HyperspaceGate>(
    await admin.from("hyperspace_gates").select("*").eq("system_id", systemId).maybeSingle(),
  );

  if (existingGate?.status === "active") {
    return toErrorResponse(fail("already_exists", "An active gate already exists in this system.").error);
  }

  if (existingGate?.status === "neutral") {
    return toErrorResponse(
      fail("invalid_target", "The gate in this system is neutral. Use the reclaim action to take control.").error,
    );
  }

  // ── Under construction — check if job is now complete ─────────────────────
  if (existingGate?.status === "inactive") {
    const { data: job } = maybeSingleResult<GateConstructionJob>(
      await admin
        .from("gate_construction_jobs")
        .select("*")
        .eq("gate_id", existingGate.id)
        .eq("status", "pending")
        .maybeSingle(),
    );

    if (job && new Date(job.complete_at) <= now) {
      // Construction complete — activate
      await admin
        .from("hyperspace_gates")
        .update({ status: "active", built_at: now.toISOString() })
        .eq("id", existingGate.id);
      await admin.from("gate_construction_jobs").update({ status: "complete" }).eq("id", job.id);

      void admin.from("world_events").insert({
        event_type: "gate_built",
        player_id: player.id,
        system_id: systemId,
        metadata: { handle: player.handle },
      });

      const activatedGate = { ...existingGate, status: "active", built_at: now.toISOString() };
      return Response.json({ ok: true, data: { gate: activatedGate, jobCompleted: true, completeAt: null } });
    }

    return Response.json({
      ok: true,
      data: {
        gate: existingGate,
        jobCompleted: false,
        completeAt: job?.complete_at ?? null,
      },
    });
  }

  // ── No gate yet — create gate + construction job ───────────────────────────
  const completeAt = new Date(now.getTime() + BALANCE.gates.constructionHours * 60 * 60 * 1000);

  const { data: newGate } = maybeSingleResult<HyperspaceGate>(
    await admin
      .from("hyperspace_gates")
      .insert({ system_id: systemId, owner_id: player.id, status: "inactive", tier: 1 })
      .select("*")
      .maybeSingle(),
  );

  if (!newGate) {
    return toErrorResponse(fail("internal_error", "Failed to create gate record.").error);
  }

  await admin.from("gate_construction_jobs").insert({
    gate_id:     newGate.id,
    player_id:   player.id,
    started_at:  now.toISOString(),
    complete_at: completeAt.toISOString(),
    status:      "pending",
  });

  return Response.json({
    ok: true,
    data: { gate: newGate, jobCompleted: false, completeAt: completeAt.toISOString() },
  });
}
