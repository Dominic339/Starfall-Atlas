/**
 * POST /api/game/station/relocate
 *
 * Instantly relocates the player's station to a new system.
 *
 * Phase 1 rules (intentionally minimal — no transit time, no range gate):
 *   1. Authenticated player with an existing player row.
 *   2. Player owns a station.
 *   3. Destination exists in the alpha catalog.
 *   4. Destination is different from the current station system.
 *
 * Note: Transit-time station movement and range constraints are documented
 * as a future phase (station_travel_jobs table). This first-pass
 * implementation does an instant UPDATE so the logistics network can be
 * tested without needing to design the full movement system yet.
 *
 * Body:   { destinationSystemId: string }
 * Returns: { ok: true }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import type { PlayerStation } from "@/lib/types/game";

const RelocateStationSchema = z.object({
  destinationSystemId: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(RelocateStationSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { destinationSystemId } = input.data;

  // ── Catalog validation ───────────────────────────────────────────────────
  const destEntry = getCatalogEntry(destinationSystemId);
  if (!destEntry) {
    return toErrorResponse(
      fail("not_found", `System '${destinationSystemId}' is not in the catalog.`).error,
    );
  }

  const admin = createAdminClient();

  // ── Fetch current station ────────────────────────────────────────────────
  const { data: station } = maybeSingleResult<PlayerStation>(
    await admin
      .from("player_stations")
      .select("id, current_system_id")
      .eq("owner_id", player.id)
      .maybeSingle(),
  );

  if (!station) {
    return toErrorResponse(
      fail("not_found", "Station not found. Try logging out and back in.").error,
    );
  }

  // ── Destination validation ───────────────────────────────────────────────
  if (station.current_system_id === destinationSystemId) {
    return toErrorResponse(
      fail("invalid_target", "Station is already in that system.").error,
    );
  }

  // ── Relocate ─────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("player_stations")
    .update({ current_system_id: destinationSystemId })
    .eq("id", station.id);

  if (error) {
    return Response.json(
      { ok: false, error: { code: "internal_error", message: "Failed to relocate station." } },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
