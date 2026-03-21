/**
 * Public player profile page — /profile/[handle]
 *
 * Publicly accessible (no auth required).
 * Shows: handle, title, bio, stats (discoveries, first discoveries, colonies, alliance).
 * Does NOT show email, auth_id, credits, or any private data.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";

export const dynamic = "force-dynamic";

interface ProfileRow {
  id: string;
  handle: string;
  title: string | null;
  bio: string | null;
  created_at: string;
  deactivated_at: string | null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return { title: `${decodeURIComponent(handle)} — Starfall Atlas` };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: rawHandle } = await params;
  const handle = decodeURIComponent(rawHandle);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ── Look up player by handle (case-insensitive) ───────────────────────────
  const { data: profile } = maybeSingleResult<ProfileRow>(
    await admin
      .from("players")
      .select("id, handle, title, bio, created_at, deactivated_at")
      .ilike("handle", handle)
      .maybeSingle(),
  );

  if (!profile || profile.deactivated_at) notFound();

  // ── Fetch public stats ─────────────────────────────────────────────────────
  const [discoveriesRes, firstDiscRows, coloniesRes, allianceRes] =
    await Promise.all([
      admin
        .from("system_discoveries")
        .select("id", { count: "exact", head: true })
        .eq("player_id", profile.id),
      listResult<{ id: string }>(
        await admin
          .from("system_discoveries")
          .select("id")
          .eq("player_id", profile.id)
          .eq("is_first", true),
      ),
      admin
        .from("colonies")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", profile.id)
        .eq("status", "active"),
      admin
        .from("alliance_members")
        .select("role, alliances(name, tag)")
        .eq("player_id", profile.id)
        .maybeSingle(),
    ]);

  const discoveryCount     = discoveriesRes.count ?? 0;
  const firstDiscCount     = firstDiscRows.data?.length ?? 0;
  const colonyCount        = coloniesRes.count ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allianceData       = allianceRes.data as any;
  const allianceName       = allianceData?.alliances?.name ?? null;
  const allianceTag        = allianceData?.alliances?.tag  ?? null;
  const allianceRole       = allianceData?.role            ?? null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950 px-6 py-3">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="font-mono text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            Starfall Atlas
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl p-6 space-y-8">
        {/* Profile header */}
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">{profile.handle}</h1>
          {profile.title && (
            <p className="mt-0.5 text-sm text-zinc-400">{profile.title}</p>
          )}
          <p className="mt-1 text-xs text-zinc-600">
            Pilot since {new Date(profile.created_at).toLocaleDateString()}
          </p>
          {allianceName && (
            <p className="mt-1 text-xs text-zinc-500">
              [{allianceTag}] {allianceName}
              {allianceRole && (
                <span className="ml-1 capitalize text-zinc-600">· {allianceRole}</span>
              )}
            </p>
          )}
        </div>

        {/* Bio */}
        {profile.bio && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-2">
              Bio
            </p>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{profile.bio}</p>
          </div>
        )}

        {/* Stats */}
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3">
            Achievements
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Systems found" value={discoveryCount} />
            <StatCard label="First discovered" value={firstDiscCount} />
            <StatCard label="Active colonies" value={colonyCount} />
            <StatCard label="Alliance" value={allianceName ?? "—"} />
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-200">{value}</p>
    </div>
  );
}
