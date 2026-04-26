/**
 * GET  /api/game/skins/admin  — list all skins + packages (full admin view)
 * POST /api/game/skins/admin  — upsert a skin or package
 * DELETE /api/game/skins/admin — delete a skin or package
 *
 * Only accessible by players with is_dev = true.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult } from "@/lib/supabase/utils";
import { ALL_SKINS } from "@/skins";
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

  const { data: skins } = listResult<Record<string, unknown>>(
    await admin.from("skins").select("*").order("created_at", { ascending: false }),
  );

  const { data: packages } = listResult<Record<string, unknown>>(
    await admin.from("skin_packages").select("*").order("created_at", { ascending: false }),
  );

  const { data: pkgItems } = listResult<{ package_id: string; skin_id: string }>(
    await admin.from("skin_package_items").select("package_id, skin_id"),
  );

  const pkgSkinMap = new Map<string, string[]>();
  for (const row of pkgItems ?? []) {
    const list = pkgSkinMap.get(row.package_id) ?? [];
    list.push(row.skin_id);
    pkgSkinMap.set(row.package_id, list);
  }

  const enrichedPackages = (packages ?? []).map((pkg) => ({
    ...pkg,
    skinIds: pkgSkinMap.get(pkg.id as string) ?? [],
  }));

  return Response.json({
    ok: true,
    data: {
      dbSkins: skins ?? [],
      packages: enrichedPackages,
      availableSkinDefs: ALL_SKINS,
    },
  });
}

export async function POST(req: Request) {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const body = await req.json().catch(() => ({}));
  const { entityType, ...data } = body as { entityType: "skin" | "package"; [k: string]: unknown };

  if (entityType === "skin") {
    const { skinIds: _ignored, ...skinData } = data as { skinIds?: unknown; [k: string]: unknown };
    await admin.from("skins").upsert(
      { ...skinData, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
    return Response.json({ ok: true, data: { message: "Skin saved" } });
  }

  if (entityType === "package") {
    const { skinIds, ...pkgData } = data as { skinIds?: string[]; [k: string]: unknown };
    await admin.from("skin_packages").upsert(
      { ...pkgData, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );

    if (skinIds !== undefined && pkgData.id) {
      // Replace package items
      await admin.from("skin_package_items").delete().eq("package_id", pkgData.id);
      if (skinIds.length > 0) {
        await admin.from("skin_package_items").insert(
          skinIds.map((sid) => ({ package_id: pkgData.id, skin_id: sid })),
        );
      }
    }
    return Response.json({ ok: true, data: { message: "Package saved" } });
  }

  return Response.json({ ok: false, error: "type must be 'skin' or 'package'" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const auth = await requireDev();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const body = await req.json().catch(() => ({}));
  const { entityType, id } = body as { entityType: "skin" | "package"; id: string };

  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  if (entityType === "skin") {
    await admin.from("skins").delete().eq("id", id);
    return Response.json({ ok: true, data: { message: "Skin deleted" } });
  }

  if (entityType === "package") {
    await admin.from("skin_packages").delete().eq("id", id);
    return Response.json({ ok: true, data: { message: "Package deleted" } });
  }

  return Response.json({ ok: false, error: "type must be 'skin' or 'package'" }, { status: 400 });
}
