/**
 * GET /api/game/leaderboard
 *
 * Returns the top 25 players ranked by three metrics:
 *   - byColonies: active colony count
 *   - byCredits:  current credit balance
 *   - byDiscoveries: first-discovery count (unique systems they discovered first)
 */

import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [coloniesRes, creditsRes, discoveriesRes] = await Promise.all([
    // Top 25 by active colony count
    admin
      .from("colonies")
      .select("owner_id, count:id")
      .eq("status", "active")
      .order("count", { ascending: false })
      .limit(25),

    // Top 25 players by credits
    admin
      .from("players")
      .select("id, handle, credits")
      .order("credits", { ascending: false })
      .limit(25),

    // Top 25 by first-discoveries
    admin
      .from("system_discoveries")
      .select("player_id, count:system_id")
      .eq("is_first", true)
      .order("count", { ascending: false })
      .limit(25),
  ]);

  // Enrich colony + discovery counts with handles (parallel)
  type ColonyCountRow = { owner_id: string; count: number };
  type DiscoveryCountRow = { player_id: string; count: number };
  const colonyRows    = (coloniesRes.data ?? []) as ColonyCountRow[];
  const discoveryRows = (discoveriesRes.data ?? []) as DiscoveryCountRow[];
  const colonyOwnerIds    = [...new Set(colonyRows.map((r) => r.owner_id))];
  const discoveryPlayerIds = [...new Set(discoveryRows.map((r) => r.player_id))];

  type HandleRow = { id: string; handle: string };
  const [colonyHandleRes, discoveryHandleRes] = await Promise.all([
    colonyOwnerIds.length > 0
      ? admin.from("players").select("id, handle").in("id", colonyOwnerIds) as Promise<{ data: HandleRow[] | null }>
      : Promise.resolve({ data: [] as HandleRow[] }),
    discoveryPlayerIds.length > 0
      ? admin.from("players").select("id, handle").in("id", discoveryPlayerIds) as Promise<{ data: HandleRow[] | null }>
      : Promise.resolve({ data: [] as HandleRow[] }),
  ]);

  const colonyHandles    = new Map<string, string>();
  const discoveryHandles = new Map<string, string>();
  for (const h of colonyHandleRes.data ?? [])    colonyHandles.set(h.id, h.handle);
  for (const h of discoveryHandleRes.data ?? []) discoveryHandles.set(h.id, h.handle);

  type CreditsRow = { id: string; handle: string; credits: number };
  const creditsRows = (creditsRes.data ?? []) as CreditsRow[];

  return Response.json({
    ok: true,
    data: {
      byColonies: colonyRows.map((r, i) => ({
        rank:   i + 1,
        handle: colonyHandles.get(r.owner_id) ?? "Unknown",
        value:  r.count,
      })),
      byCredits: creditsRows.map((r, i) => ({
        rank:   i + 1,
        handle: r.handle,
        value:  r.credits,
      })),
      byDiscoveries: discoveryRows.map((r, i) => ({
        rank:   i + 1,
        handle: discoveryHandles.get(r.player_id) ?? "Unknown",
        value:  r.count,
      })),
    },
  });
}
