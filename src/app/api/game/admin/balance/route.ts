/**
 * GET    /api/game/admin/balance  — list all active overrides
 * POST   /api/game/admin/balance  — upsert an override { key, value, description }
 * DELETE /api/game/admin/balance  — delete an override by key
 *
 * is_dev only. Calls invalidateBalanceCache() after writes.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import { fail } from "@/lib/actions/types";
import { invalidateBalanceCache } from "@/lib/config/balanceOverrides";

export const dynamic = "force-dynamic";

async function requireDev() {
  const auth = await requireAuth();
  if (!auth.ok) return auth;
  if (!auth.data.player.is_dev) return fail("forbidden", "Dev access required");
  return auth;
}

export async function GET() {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = listResult<{ key: string; value: unknown; description: string; updated_at: string }>(
    await admin.from("balance_overrides").select("key, value, description, updated_at").order("key"),
  );
  return Response.json({ ok: true, data: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  const { player } = auth.data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { key, value, description } = await req.json().catch(() => ({})) as {
    key?: string; value?: unknown; description?: string;
  };

  if (!key) return Response.json({ ok: false, error: "key required" }, { status: 400 });
  if (value === undefined) return Response.json({ ok: false, error: "value required" }, { status: 400 });

  await admin.from("balance_overrides").upsert(
    { key, value, description: description ?? "", updated_by: player.id, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  invalidateBalanceCache();
  return Response.json({ ok: true, data: { message: "Override saved" } });
}

export async function DELETE(req: Request) {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { key } = await req.json().catch(() => ({})) as { key?: string };
  if (!key) return Response.json({ ok: false, error: "key required" }, { status: 400 });

  await admin.from("balance_overrides").delete().eq("key", key);
  invalidateBalanceCache();
  return Response.json({ ok: true, data: { message: "Override removed" } });
}
