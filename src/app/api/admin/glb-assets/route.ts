import { readdir } from "fs/promises";
import path from "path";
import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: player } = await admin
    .from("players").select("is_dev").eq("id", auth.data.player.id).maybeSingle();
  if (!player?.is_dev) return toErrorResponse(fail("forbidden", "Dev access required").error);

  const assetsDir = path.join(process.cwd(), "public/assets/planets");
  const files = await readdir(assetsDir);
  const glbFiles = files
    .filter((f) => f.endsWith(".glb"))
    .sort()
    .map((f) => ({
      name: f.replace(/\.glb$/i, ""),
      path: `/assets/planets/${f}`,
    }));

  return Response.json({ ok: true, data: { files: glbFiles } });
}
