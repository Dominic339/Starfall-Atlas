/**
 * POST /api/game/premium/consume
 *
 * Consumes a premium entitlement for the authenticated player.
 * Body: { entitlementId: string, params?: Record<string, unknown> }
 */

import { type NextRequest } from "next/server";
import { toErrorResponse } from "@/lib/actions/helpers";
import { consumePremiumItem } from "@/lib/actions/premium";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const result = await consumePremiumItem(body);
  if (!result.ok) return toErrorResponse(result.error);
  return Response.json({ ok: true, data: result.data });
}
