/**
 * /game/leaderboard — Player Rankings
 *
 * Server component. Shows top 25 players across three categories:
 *   - Most active colonies
 *   - Highest credit balance
 *   - Most first-discoveries
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboard — Starfall Atlas" };

type RankEntry = { rank: number; handle: string; value: number };

async function fetchLeaderboard(): Promise<{
  byColonies:    RankEntry[];
  byCredits:     RankEntry[];
  byDiscoveries: RankEntry[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [coloniesRes, creditsRes, discoveriesRes] = await Promise.all([
    admin.rpc
      ? admin
          .from("colonies")
          .select("owner_id")
          .eq("status", "active")
      : null,
    admin.from("players").select("id, handle, credits").order("credits", { ascending: false }).limit(25),
    admin.from("system_discoveries").select("player_id").eq("is_first", true),
  ]);

  // Colony counts by owner
  type ColonyRow = { owner_id: string };
  const allColonyRows = (coloniesRes?.data ?? []) as ColonyRow[];
  const colonyCounts = new Map<string, number>();
  for (const r of allColonyRows) {
    colonyCounts.set(r.owner_id, (colonyCounts.get(r.owner_id) ?? 0) + 1);
  }

  // Discovery counts by player
  type DiscRow = { player_id: string };
  const allDiscRows = (discoveriesRes?.data ?? []) as DiscRow[];
  const discCounts = new Map<string, number>();
  for (const r of allDiscRows) {
    discCounts.set(r.player_id, (discCounts.get(r.player_id) ?? 0) + 1);
  }

  // Resolve handles for colony + discovery leaderboards
  const colonyIds    = [...colonyCounts.keys()];
  const discoveryIds = [...discCounts.keys()];
  const allPlayerIds = [...new Set([...colonyIds, ...discoveryIds])];
  const handleMap    = new Map<string, string>();

  if (allPlayerIds.length > 0) {
    const { data: hRows } = await admin
      .from("players")
      .select("id, handle")
      .in("id", allPlayerIds) as { data: { id: string; handle: string }[] | null };
    for (const h of hRows ?? []) handleMap.set(h.id, h.handle);
  }

  const byColonies: RankEntry[] = [...colonyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([id, count], i) => ({ rank: i + 1, handle: handleMap.get(id) ?? "Unknown", value: count }));

  type CreditsRow = { id: string; handle: string; credits: number };
  const byCredits: RankEntry[] = ((creditsRes?.data ?? []) as CreditsRow[]).map((r, i) => ({
    rank: i + 1, handle: r.handle, value: r.credits,
  }));

  const byDiscoveries: RankEntry[] = [...discCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([id, count], i) => ({ rank: i + 1, handle: handleMap.get(id) ?? "Unknown", value: count }));

  return { byColonies, byCredits, byDiscoveries };
}

// ---------------------------------------------------------------------------
// Rank table component
// ---------------------------------------------------------------------------

function RankTable({
  title,
  entries,
  valueLabel,
  valueFormat,
}: {
  title:       string;
  entries:     RankEntry[];
  valueLabel:  string;
  valueFormat: (v: number) => string;
}) {
  return (
    <div className="flex-1 min-w-0">
      <h2 className="text-sm font-semibold text-zinc-300 mb-3 border-b border-zinc-800 pb-2">
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="text-xs text-zinc-600">No data yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-600">
              <th className="text-left pb-1 pr-2 font-normal w-6">#</th>
              <th className="text-left pb-1 font-normal">Player</th>
              <th className="text-right pb-1 font-normal text-zinc-500">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.rank}
                className={`border-t border-zinc-800/50 ${entry.rank <= 3 ? "text-zinc-200" : "text-zinc-500"}`}
              >
                <td className="py-1 pr-2">
                  {entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : entry.rank}
                </td>
                <td className="py-1 font-medium truncate max-w-[120px]">{entry.handle}</td>
                <td className="py-1 text-right tabular-nums">{valueFormat(entry.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function LeaderboardPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const { byColonies, byCredits, byDiscoveries } = await fetchLeaderboard();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      {/* Nav */}
      <div className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <Link href="/game/map" className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
          ← Galaxy Map
        </Link>
        <h1 className="text-sm font-semibold tracking-wide text-zinc-300">Leaderboard</h1>
        <div className="w-20" />
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-xs text-zinc-600 mb-8">Rankings update on every page load.</p>
        <div className="flex flex-col md:flex-row gap-8">
          <RankTable
            title="Most Colonies"
            entries={byColonies}
            valueLabel="colonies"
            valueFormat={(v) => String(v)}
          />
          <RankTable
            title="Wealthiest"
            entries={byCredits}
            valueLabel="credits"
            valueFormat={(v) => v.toLocaleString()}
          />
          <RankTable
            title="Top Explorers"
            entries={byDiscoveries}
            valueLabel="first discoveries"
            valueFormat={(v) => String(v)}
          />
        </div>
      </div>
    </div>
  );
}
