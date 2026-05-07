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
// Sub-components
// ---------------------------------------------------------------------------

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold shrink-0">
      1
    </span>
  );
  if (rank === 2) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-zinc-400/10 border border-zinc-500/25 text-zinc-300 text-[10px] font-bold shrink-0">
      2
    </span>
  );
  if (rank === 3) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-900/20 border border-orange-800/30 text-orange-500 text-[10px] font-bold shrink-0">
      3
    </span>
  );
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 text-[10px] text-zinc-700 tabular-nums shrink-0">
      {rank}
    </span>
  );
}

function ColoniesIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M8 1a.5.5 0 0 1 .374.167l6 6.5A.5.5 0 0 1 14 8H2a.5.5 0 0 1-.374-.833l6-6.5A.5.5 0 0 1 8 1zm0 1.648L3.276 7h9.448L8 2.648zM5 8h1.5v5H8v-3h1v3h1.5V8H12v6H4V8h1z" clipRule="evenodd" />
    </svg>
  );
}

function CreditsIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM7.25 5v.382A1.75 1.75 0 0 0 7.25 9v.5c0 .691.56 1.25 1.25 1.25s1.25-.559 1.25-1.25V9A1.75 1.75 0 0 0 8.75 5.382V5h-1.5zm.375 1.5h.75A.25.25 0 0 1 8.625 6.75v1.5A.25.25 0 0 1 8.375 8.5h-.75A.25.25 0 0 1 7.375 8.25v-1.5A.25.25 0 0 1 7.625 6.5z" />
    </svg>
  );
}

function ExplorerIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1.5a.5.5 0 0 1 .5.5v1.586l1.121-1.121a.5.5 0 1 1 .707.707L9.207 4.293l.636.636a.5.5 0 1 1-.707.707L8.5 4.999V6.5a.5.5 0 0 1-1 0V5.009l-.629.629a.5.5 0 0 1-.707-.707L7.5 3.585V2a.5.5 0 0 1 .5-.5zm0 3.5A4.5 4.5 0 1 0 12.5 9 4.505 4.505 0 0 0 8 5zm0 1.5A3 3 0 1 1 5 9a3 3 0 0 1 3-3z" />
    </svg>
  );
}

function RankPanel({
  title,
  accentGradient,
  iconBg,
  iconColor,
  icon,
  entries,
  valueLabel,
  valueFormat,
}: {
  title:           string;
  accentGradient:  string;
  iconBg:          string;
  iconColor:       string;
  icon:            React.ReactNode;
  entries:         RankEntry[];
  valueLabel:      string;
  valueFormat:     (v: number) => string;
}) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/80 overflow-hidden animate-fade-in-up">
      {/* Top accent line */}
      <div className={`h-px bg-gradient-to-r ${accentGradient}`} />

      {/* Panel header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800/60">
        <span className={`w-6 h-6 rounded-md flex items-center justify-center border shrink-0 ${iconBg} ${iconColor}`}>
          {icon}
        </span>
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        <span className="ml-auto text-[10px] text-zinc-700 font-mono">
          {entries.length > 0 ? `top ${entries.length}` : "—"}
        </span>
      </div>

      {/* Column labels */}
      {entries.length > 0 && (
        <div className="flex items-center gap-3 px-4 pt-2 pb-1">
          <span className="w-6 shrink-0" />
          <span className="flex-1 text-[10px] uppercase tracking-widest text-zinc-700">Player</span>
          <span className="text-[10px] uppercase tracking-widest text-zinc-700">{valueLabel}</span>
        </div>
      )}

      {/* Rows */}
      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-10 text-center">
          <svg className="w-6 h-6 text-zinc-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
          <p className="text-xs text-zinc-700">No data yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/40 stagger-children">
          {entries.map((entry) => (
            <div
              key={entry.rank}
              className={`flex items-center gap-3 px-4 py-2 ${
                entry.rank === 1
                  ? "bg-amber-950/10"
                  : entry.rank <= 3
                    ? "bg-zinc-800/10"
                    : ""
              }`}
            >
              <RankBadge rank={entry.rank} />
              <span className={`flex-1 text-xs font-medium truncate ${
                entry.rank <= 3 ? "text-zinc-100" : "text-zinc-400"
              }`}>
                {entry.handle}
              </span>
              <span className={`text-xs tabular-nums font-mono shrink-0 ${
                entry.rank === 1
                  ? "text-amber-400"
                  : entry.rank <= 3
                    ? "text-zinc-300"
                    : "text-zinc-600"
              }`}>
                {valueFormat(entry.value)}
              </span>
            </div>
          ))}
        </div>
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
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link
          href="/game/command"
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          ← Command
        </Link>
        <span className="text-zinc-800 text-xs">/</span>
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Leaderboard
        </span>
      </div>

      {/* Page title */}
      <div>
        <h1 className="text-lg font-bold tracking-tight text-zinc-100">Leaderboard</h1>
        <p className="mt-1 text-xs text-zinc-600">
          Rankings update on every page load · top 25 players per category
        </p>
      </div>

      {/* Three panels side by side on md+ */}
      <div className="flex flex-col md:flex-row gap-4 stagger-children">
        <RankPanel
          title="Most Colonies"
          accentGradient="from-violet-600/0 via-violet-500/60 to-violet-600/0"
          iconBg="bg-violet-950/60 border-violet-800/40"
          iconColor="text-violet-400"
          icon={<ColoniesIcon />}
          entries={byColonies}
          valueLabel="colonies"
          valueFormat={(v) => String(v)}
        />
        <RankPanel
          title="Wealthiest"
          accentGradient="from-amber-600/0 via-amber-500/60 to-amber-600/0"
          iconBg="bg-amber-950/60 border-amber-800/40"
          iconColor="text-amber-400"
          icon={<CreditsIcon />}
          entries={byCredits}
          valueLabel="credits"
          valueFormat={(v) => v.toLocaleString()}
        />
        <RankPanel
          title="Top Explorers"
          accentGradient="from-sky-600/0 via-sky-500/60 to-sky-600/0"
          iconBg="bg-sky-950/60 border-sky-800/40"
          iconColor="text-sky-400"
          icon={<ExplorerIcon />}
          entries={byDiscoveries}
          valueLabel="discoveries"
          valueFormat={(v) => String(v)}
        />
      </div>
    </div>
  );
}
