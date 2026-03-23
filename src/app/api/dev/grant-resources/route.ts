/**
 * POST /api/dev/grant-resources
 *
 * Dev-only: adds resources directly to any inventory location.
 *
 * Authorization: the authenticated player must have is_dev = TRUE in the
 * players table. This is checked server-side in the dev_grant_resources()
 * Postgres function. Unlike the old dev endpoints, this is not gated by
 * NODE_ENV so it works in staging and preview environments.
 *
 * Body:
 *   locationType  "station" | "colony"  (ship/alliance_storage not exposed via UI)
 *   locationId    UUID of the station or colony
 *   resources     Array of { resourceType: string, quantity: number }
 *
 * Returns: { ok: true, data: { granted: { resourceType, quantity }[] } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";

const GrantSchema = z.object({
  locationType: z.enum(["station", "colony"]),
  locationId: z.string().uuid(),
  resources: z
    .array(
      z.object({
        resourceType: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(1_000_000),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // ── Input ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => ({}));
  const input = parseInput(GrantSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { locationType, locationId, resources } = input.data;

  // ── Dev guard (DB-side, not NODE_ENV) ────────────────────────────────────
  if (!player.is_dev) {
    return toErrorResponse(
      fail("forbidden", "Only dev accounts can grant resources.").error,
    );
  }

  const admin = createAdminClient();
  const granted: { resourceType: string; quantity: number }[] = [];

  // ── Grant each resource via the Postgres RPC ─────────────────────────────
  for (const { resourceType, quantity } of resources) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).rpc("dev_grant_resources", {
      p_location_type: locationType,
      p_location_id: locationId,
      p_resource_type: resourceType,
      p_quantity: quantity,
      p_granting_player_id: player.id,
    });

    if (error) {
      return toErrorResponse(
        fail(
          "internal_error",
          `Failed to grant ${resourceType}: ${error.message}`,
        ).error,
      );
    }

    granted.push({ resourceType, quantity });
  }

  return Response.json({ ok: true, data: { granted } });
}
