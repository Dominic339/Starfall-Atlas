/**
 * POST /api/game/skins/equip
 *
 * Equip or unequip a skin for a given slot.
 * Body: { slot: 'ship' | 'station' | 'fleet'; skinId: string | null }
 *
 * skinId = null to unequip (revert to default).
 * Player must own the skin to equip it.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  const body = await req.json().catch(() => ({}));
  const { slot, skinId } = body as { slot?: string; skinId?: string | null };

  if (!slot || !["ship", "station", "fleet"].includes(slot)) {
    return Response.json({ ok: false, error: "slot must be 'ship', 'station', or 'fleet'" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  if (skinId) {
    // Verify ownership
    const { data: owned } = await admin
      .from("player_skins")
      .select("id")
      .eq("player_id", player.id)
      .eq("skin_id", skinId)
      .maybeSingle();

    if (!owned) {
      return Response.json({ ok: false, error: "You do not own this skin" }, { status: 403 });
    }

    // Verify skin type matches slot
    const { data: skinRow } = await admin
      .from("skins")
      .select("type")
      .eq("id", skinId)
      .maybeSingle();

    if (!skinRow) {
      return Response.json({ ok: false, error: "Skin not found" }, { status: 404 });
    }

    if (skinRow.type !== slot) {
      return Response.json(
        { ok: false, error: `Skin type '${skinRow.type}' cannot be equipped in '${slot}' slot` },
        { status: 400 },
      );
    }
  }

  const column = `${slot}_skin_id`;
  await admin
    .from("player_equipped_skins")
    .upsert(
      { player_id: player.id, [column]: skinId ?? null, updated_at: new Date().toISOString() },
      { onConflict: "player_id" },
    );

  return Response.json({ ok: true, data: { slot, skinId: skinId ?? null } });
}
