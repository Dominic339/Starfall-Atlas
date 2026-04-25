/**
 * GET    /api/game/admin/ships  — list all ship classes
 * POST   /api/game/admin/ships  — upsert a ship class
 * DELETE /api/game/admin/ships  — delete a ship class by id
 *
 * is_dev only.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import { fail } from "@/lib/actions/types";

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
  const { data } = listResult<Record<string, unknown>>(
    await admin.from("ship_classes").select("*").order("sort_order").order("name"),
  );
  return Response.json({ ok: true, data: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const body = await req.json().catch(() => ({}));
  const { id, ...rest } = body as { id?: string; [k: string]: unknown };

  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  await admin.from("ship_classes").upsert(
    { id, ...rest, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );
  return Response.json({ ok: true, data: { message: "Ship class saved" } });
}

export async function DELETE(req: Request) {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  await admin.from("ship_classes").delete().eq("id", id);
  return Response.json({ ok: true, data: { message: "Ship class deleted" } });
}
