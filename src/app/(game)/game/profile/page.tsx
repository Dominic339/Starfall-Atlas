/**
 * Private profile & settings page — /game/profile
 *
 * Shows the player's current profile info and lets them edit:
 *   - Handle (username)
 *   - Title (cosmetic tag, max 64 chars)
 *   - Bio (max 512 chars)
 *
 * Also shows account stats and provides a danger-zone account deletion
 * form with a confirmation phrase guard.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import type { Player } from "@/lib/types/game";
import { ProfileEditForm } from "./_components/ProfileEditForm";
import { DeleteAccountForm } from "./_components/DeleteAccountForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Profile & Settings — Starfall Atlas" };

export default async function ProfilePage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin
      .from("players")
      .select("*")
      .eq("auth_id", user.id)
      .maybeSingle(),
  );

  if (!player) redirect("/login");

  // ── Stats ──────────────────────────────────────────────────────────────────
  const [discoveriesRes, coloniesRes, allianceRes] = await Promise.all([
    admin
      .from("system_discoveries")
      .select("id", { count: "exact", head: true })
      .eq("player_id", player.id),
    admin
      .from("colonies")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", player.id)
      .eq("status", "active"),
    admin
      .from("alliance_members")
      .select("alliance_id, role, alliances(name, tag)")
      .eq("player_id", player.id)
      .maybeSingle(),
  ]);

  const discoveryCount = discoveriesRes.count ?? 0;
  const colonyCount    = coloniesRes.count ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allianceData   = allianceRes.data as any;
  const allianceName   = allianceData?.alliances?.name ?? null;
  const allianceTag    = allianceData?.alliances?.tag  ?? null;
  const allianceRole   = allianceData?.role            ?? null;

  // First-discovered count
  const { data: firstDiscRows } = listResult<{ id: string }>(
    await admin
      .from("system_discoveries")
      .select("id")
      .eq("player_id", player.id)
      .eq("is_first", true),
  );
  const firstDiscoveryCount = firstDiscRows?.length ?? 0;

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-xs text-zinc-600">
        <Link href="/game/command" className="hover:text-zinc-400">
          Command Centre
        </Link>
        {" › "}
        <span className="text-zinc-400">Profile & Settings</span>
      </nav>

      <div className="flex items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">{player.handle}</h1>
          {player.title && (
            <p className="mt-0.5 text-sm text-zinc-400">{player.title}</p>
          )}
          <p className="mt-1 text-xs text-zinc-600">
            Joined {new Date(player.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Discoveries" value={discoveryCount} />
        <StatCard label="First discoveries" value={firstDiscoveryCount} />
        <StatCard label="Active colonies" value={colonyCount} />
        <StatCard
          label="Alliance"
          value={allianceName ? `[${allianceTag}] ${allianceName}` : "—"}
          sub={allianceRole ?? undefined}
        />
      </div>

      {/* Bio */}
      {player.bio && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">
            Bio
          </p>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">{player.bio}</p>
        </div>
      )}

      {/* Edit form */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Edit Profile</h2>
        <ProfileEditForm
          currentHandle={player.handle}
          currentTitle={player.title ?? ""}
          currentBio={player.bio ?? ""}
        />
      </div>

      {/* Public profile link */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">
          Public Profile
        </p>
        <Link
          href={`/profile/${encodeURIComponent(player.handle)}`}
          className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          /profile/{player.handle} →
        </Link>
      </div>

      {/* Danger zone */}
      <div className="rounded-lg border border-red-900/40 bg-zinc-950 p-5">
        <h2 className="text-sm font-semibold text-red-400 mb-2">Danger Zone</h2>
        <p className="text-xs text-zinc-500 mb-4">
          Deleting your account is a soft-delete — your data is retained for 30 days
          and then permanently removed. You will immediately lose access to the game.
        </p>
        <DeleteAccountForm />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-200">{value}</p>
      {sub && <p className="text-xs text-zinc-600 capitalize">{sub}</p>}
    </div>
  );
}
