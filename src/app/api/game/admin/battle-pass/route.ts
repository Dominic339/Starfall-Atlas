/**
 * GET    /api/game/admin/battle-pass  — list all battle passes + tiers
 * POST   /api/game/admin/battle-pass  — create/update a pass and its tiers
 * DELETE /api/game/admin/battle-pass  — delete a pass
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
  const { data: passes } = listResult<Record<string, unknown>>(
    await admin.from("battle_passes").select("*").order("season_number", { ascending: false }),
  );
  const { data: tiers } = listResult<Record<string, unknown>>(
    await admin.from("battle_pass_tiers").select("*").order("tier"),
  );

  const tiersByPass = new Map<string, typeof tiers>();
  for (const t of tiers ?? []) {
    const pid = t.pass_id as string;
    const list = tiersByPass.get(pid) ?? [];
    list.push(t);
    tiersByPass.set(pid, list);
  }

  const enriched = (passes ?? []).map((p) => ({
    ...p,
    tiers: tiersByPass.get(p.id as string) ?? [],
  }));

  return Response.json({ ok: true, data: enriched });
}

export async function POST(req: Request) {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const body = await req.json().catch(() => ({}));
  const { tiers: tiersDef, ...passData } = body as {
    tiers?: Record<string, unknown>[];
    [k: string]: unknown;
  };

  const isNew = !passData.id;
  if (isNew) delete passData.id;

  const { data: savedPass } = await admin
    .from("battle_passes")
    .upsert({ ...passData, updated_at: new Date().toISOString() }, { onConflict: isNew ? undefined : "id" })
    .select("id")
    .single();

  const passId = (savedPass as { id?: string })?.id ?? passData.id;

  if (tiersDef && passId) {
    // Replace all tiers for this pass
    await admin.from("battle_pass_tiers").delete().eq("pass_id", passId);
    if (tiersDef.length > 0) {
      await admin.from("battle_pass_tiers").insert(
        tiersDef.map((t) => ({ ...t, pass_id: passId })),
      );
    }
  }

  return Response.json({ ok: true, data: { passId, message: "Battle pass saved" } });
}

export async function DELETE(req: Request) {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  await admin.from("battle_passes").delete().eq("id", id);
  return Response.json({ ok: true, data: { message: "Battle pass deleted" } });
}
