/**
 * GET /api/game/alliance/panel
 *
 * Returns alliance state for the map overlay — membership, members,
 * shared storage, active goals, and station inventory for deposit UI.
 * Returns { inAlliance: false } if the player is not in an alliance.
 */

import { requireAuth, toErrorResponse } from "@/lib/actions/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import type { AllianceRole } from "@/lib/types/enums";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player } = auth.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Membership check
  type MemberRow = { id: string; alliance_id: string; role: AllianceRole; alliance_credits: number };
  const { data: membership } = maybeSingleResult<MemberRow>(
    await admin.from("alliance_members").select("id, alliance_id, role, alliance_credits").eq("player_id", player.id).maybeSingle(),
  );

  if (!membership) {
    return Response.json({ ok: true, data: { inAlliance: false } });
  }

  // Parallel fetches
  const [allianceRes, membersRes, storageRes, goalsRes, stationRes] = await Promise.all([
    admin.from("alliances").select("id, name, tag, invite_code, member_count").eq("id", membership.alliance_id).maybeSingle(),
    admin.from("alliance_members").select("id, player_id, role, alliance_credits").eq("alliance_id", membership.alliance_id).order("joined_at", { ascending: true }),
    admin.from("resource_inventory").select("resource_type, quantity").eq("location_type", "alliance_storage").eq("location_id", membership.alliance_id),
    admin.from("alliance_goals").select("id, title, resource_type, quantity_target, quantity_filled, credit_reward, deadline_at, completed_at").eq("alliance_id", membership.alliance_id).eq("status", "active").order("deadline_at", { ascending: true }),
    admin.from("player_stations").select("id").eq("owner_id", player.id).maybeSingle(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alliance = (allianceRes.data as any);
  type RawMember = { id: string; player_id: string; role: AllianceRole; alliance_credits: number };
  const rawMembers = listResult<RawMember>(membersRes).data ?? [];

  // Resolve handles
  const playerIds = rawMembers.map((m) => m.player_id);
  const handleMap = new Map<string, string>();
  if (playerIds.length > 0) {
    const { data: handles } = await admin.from("players").select("id, handle").in("id", playerIds);
    for (const h of (handles ?? []) as { id: string; handle: string }[]) handleMap.set(h.id, h.handle);
  }

  const members = rawMembers.map((m) => ({
    id: m.id,
    playerId: m.player_id,
    handle: handleMap.get(m.player_id) ?? "Unknown",
    role: m.role as string,
    allianceCredits: m.alliance_credits,
    isSelf: m.player_id === player.id,
  }));

  type StorageRow = { resource_type: string; quantity: number };
  const storage = (listResult<StorageRow>(storageRes).data ?? []).map((r) => ({
    resource: r.resource_type, quantity: r.quantity,
  }));

  type GoalRow = { id: string; title: string; resource_type: string; quantity_target: number; quantity_filled: number; credit_reward: number; deadline_at: string; completed_at: string | null };
  const goals = (listResult<GoalRow>(goalsRes).data ?? []).map((g) => ({
    id: g.id,
    title: g.title,
    resource: g.resource_type,
    target: g.quantity_target,
    filled: g.quantity_filled,
    creditReward: g.credit_reward,
    deadlineAt: g.deadline_at,
    pct: g.quantity_target > 0 ? Math.round((g.quantity_filled / g.quantity_target) * 100) : 0,
  }));

  // Station inventory for deposit UI
  let stationInventory: { resource: string; quantity: number }[] = [];
  const station = maybeSingleResult<{ id: string }>(stationRes).data;
  if (station) {
    const { data: inv } = await admin.from("resource_inventory").select("resource_type, quantity").eq("location_type", "station").eq("location_id", station.id);
    stationInventory = ((inv ?? []) as StorageRow[]).map((r) => ({ resource: r.resource_type, quantity: r.quantity }));
  }

  return Response.json({
    ok: true,
    data: {
      inAlliance: true,
      myRole: membership.role,
      myAllianceCredits: membership.alliance_credits,
      alliance: {
        id: alliance?.id,
        name: alliance?.name,
        tag: alliance?.tag,
        inviteCode: alliance?.invite_code,
        memberCount: alliance?.member_count ?? members.length,
      },
      members,
      storage,
      goals,
      stationInventory,
    },
  });
}
