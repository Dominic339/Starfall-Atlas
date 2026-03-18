/**
 * POST /api/game/discover
 *
 * Registers a system discovery for the authenticated player.
 *
 * First-discoverer stewardship is awarded atomically using the UNIQUE
 * constraint on system_stewardship(system_id):
 *   - The first player to insert a stewardship row wins.
 *   - Subsequent inserts conflict and are silently discarded.
 *   - The discovery record's is_first flag is set based on whether the
 *     stewardship insert succeeded (data != null).
 *
 * Race safety:
 *   - UNIQUE(system_id, player_id) on system_discoveries prevents duplicate rows.
 *   - UNIQUE(system_id) on system_stewardship prevents duplicate stewards.
 *   - Both inserts are ON CONFLICT / maybeSingle so they never throw on contention.
 *
 * Sol exception:
 *   - Sol (system_id = "sol") cannot be discovered through this route.
 *   - It is a canonical starter system with no steward and no discovery record.
 *
 * Presence requirement:
 *   - The player's ship must be in the system (current_system_id = systemId)
 *     with no pending travel job (i.e., fully arrived).
 *
 * Body: { systemId: string }
 * Returns: {
 *   ok: true,
 *   data: {
 *     isFirst: boolean,
 *     discovery: SystemDiscovery,
 *     stewardship: SystemStewardship | null,
 *   }
 * }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, singleResult } from "@/lib/supabase/utils";
import { getCatalogEntry } from "@/lib/catalog";
import { SOL_SYSTEM_ID } from "@/lib/config/constants";
import type { Ship, SystemDiscovery, SystemStewardship } from "@/lib/types/game";

const DiscoverSchema = z.object({
  systemId: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(DiscoverSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { systemId } = input.data;

  // ── Sol guard ────────────────────────────────────────────────────────────
  if (systemId === SOL_SYSTEM_ID) {
    return toErrorResponse(
      fail(
        "invalid_target",
        "Sol is a canonical starter system and cannot be discovered.",
      ).error,
    );
  }

  // ── Catalog check ────────────────────────────────────────────────────────
  const catalogEntry = getCatalogEntry(systemId);
  if (!catalogEntry) {
    return toErrorResponse(
      fail("not_found", `System '${systemId}' is not in the catalog.`).error,
    );
  }

  const admin = createAdminClient();

  // ── Presence check ───────────────────────────────────────────────────────
  // Player's ship must be at this system (not in transit).
  const { data: ship } = singleResult<Ship>(
    await admin
      .from("ships")
      .select("current_system_id")
      .eq("owner_id", player.id)
      .single(),
  );

  if (!ship) {
    return toErrorResponse(fail("not_found", "Ship not found.").error);
  }

  if (!ship.current_system_id || ship.current_system_id !== systemId) {
    return toErrorResponse(
      fail(
        "invalid_target",
        "Your ship must be physically present in the system to discover it. " +
          "Travel to the system and resolve your arrival first.",
      ).error,
    );
  }

  // ── Idempotency check ────────────────────────────────────────────────────
  // If the player already has a discovery record for this system, return it.
  const { data: existingDiscovery } = maybeSingleResult<SystemDiscovery>(
    await admin
      .from("system_discoveries")
      .select("*")
      .eq("system_id", systemId)
      .eq("player_id", player.id)
      .maybeSingle(),
  );

  if (existingDiscovery) {
    // Already discovered — fetch the matching stewardship if this player is steward.
    const { data: existingStewardship } =
      maybeSingleResult<SystemStewardship>(
        await admin
          .from("system_stewardship")
          .select("*")
          .eq("system_id", systemId)
          .maybeSingle(),
      );

    return Response.json({
      ok: true,
      data: {
        isFirst: existingDiscovery.is_first,
        discovery: existingDiscovery,
        stewardship: existingStewardship ?? null,
      },
    });
  }

  // ── Try to register first-discoverer stewardship ─────────────────────────
  // UNIQUE(system_id) on system_stewardship means only one insert can succeed.
  // If ours succeeds (data returned), we are the first discoverer.
  // If another player's insert wins the race (conflict), data = null.
  const { data: newStewardship } = maybeSingleResult<SystemStewardship>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("system_stewardship")
      .insert({
        system_id: systemId,
        steward_id: player.id,
        method: "discovery",
        has_governance: true,
        royalty_rate: 0,
      })
      .select("*")
      .maybeSingle(),
  );

  const isFirst = newStewardship !== null;

  // ── Insert discovery record ──────────────────────────────────────────────
  // ON CONFLICT (system_id, player_id) DO NOTHING guards against race on the
  // discovery row itself. If discovery already exists, maybeSingle returns null.
  const { data: discovery } = maybeSingleResult<SystemDiscovery>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("system_discoveries")
      .insert({
        system_id: systemId,
        player_id: player.id,
        is_first: isFirst,
      })
      .select("*")
      .maybeSingle(),
  );

  if (!discovery) {
    // Conflict: another concurrent request created the discovery for this player
    // in the narrow window between our idempotency check and our insert.
    // Fetch the existing row and return it.
    const { data: raced } = maybeSingleResult<SystemDiscovery>(
      await admin
        .from("system_discoveries")
        .select("*")
        .eq("system_id", systemId)
        .eq("player_id", player.id)
        .maybeSingle(),
    );

    return Response.json({
      ok: true,
      data: {
        isFirst: raced?.is_first ?? false,
        discovery: raced,
        stewardship: newStewardship ?? null,
      },
    });
  }

  // ── Emit world events ────────────────────────────────────────────────────
  // Insert world events for this discovery (and stewardship if first).
  // These are best-effort — failures do not roll back the discovery.
  const events: object[] = [
    {
      event_type: "system_discovered",
      player_id: player.id,
      system_id: systemId,
      metadata: { handle: player.handle, system_name: catalogEntry.properName },
    },
  ];

  if (isFirst) {
    events.push({
      event_type: "stewardship_registered",
      player_id: player.id,
      system_id: systemId,
      metadata: {
        handle: player.handle,
        system_name: catalogEntry.properName,
        method: "discovery",
      },
    });
  }

  // Fire-and-forget world events (no await needed for correctness).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void (admin as any).from("world_events").insert(events);

  // ── Fetch final stewardship for response ────────────────────────────────
  let finalStewardship: SystemStewardship | null = newStewardship;
  if (!finalStewardship) {
    const { data: existingFinal } = maybeSingleResult<SystemStewardship>(
      await admin
        .from("system_stewardship")
        .select("*")
        .eq("system_id", systemId)
        .maybeSingle(),
    );
    finalStewardship = existingFinal;
  }

  return Response.json({
    ok: true,
    data: {
      isFirst,
      discovery,
      stewardship: finalStewardship ?? null,
    },
  });
}
