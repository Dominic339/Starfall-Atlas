/**
 * /game/command — Summary & Dev Tools (demoted from primary hub).
 *
 * The Galaxy Map (/game/map) is now the primary game surface.
 * The Station page (/game/station) is the logistics hub.
 * This page is a lightweight overview + developer tooling.
 *
 * Shows:
 *   - Credits, iron, ship/colony counts at a glance
 *   - Quick links to dedicated management pages
 *   - Dev controls (complete travel, grant resources) for dev accounts
 *
 * Engine tick + travel resolution still runs here so that visiting
 * this page also advances game state (idempotent — safe to run on
 * multiple pages).
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult, listResult } from "@/lib/supabase/utils";
import { systemDisplayName } from "@/lib/catalog";
import { BALANCE } from "@/lib/config/balance";
import { runEngineTick } from "@/lib/game/engineTick";
import { getBalanceWithOverrides } from "@/lib/config/balanceOverrides";
import { runTravelResolution } from "@/lib/game/travelResolution";
import type { Player, Ship, Colony, PlayerStation, TravelJob } from "@/lib/types/game";
import { DevControls } from "./_components/DevControls";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Command — Starfall Atlas",
};

export default async function CommandPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const [balance, playerRes] = await Promise.all([
    getBalanceWithOverrides(admin),
    admin.from("players").select("*").eq("auth_id", user.id).maybeSingle(),
  ]);

  const { data: player } = maybeSingleResult<Player>(playerRes);
  if (!player) redirect("/login");

  // Engine tick + travel resolution (idempotent — also runs on /game/map)
  const requestTime = new Date();
  await runEngineTick(admin, player.id, requestTime, balance);
  await runTravelResolution(admin, player.id, requestTime);

  // Parallel fetches for summary data
  const [shipsRes, coloniesRes, stationRes, pendingJobsRes] = await Promise.all([
    admin.from("ships").select("id, name, current_system_id, ship_state").eq("owner_id", player.id),
    admin.from("colonies").select("id, system_id, body_id, status, population_tier, upkeep_missed_periods, abandoned_at").eq("owner_id", player.id),
    admin.from("player_stations").select("*").eq("owner_id", player.id).maybeSingle(),
    admin.from("travel_jobs").select("id").eq("player_id", player.id).eq("status", "pending"),
  ]);

  const ships = listResult<Pick<Ship, "id" | "name" | "current_system_id" | "ship_state">>(shipsRes).data ?? [];
  const colonies = listResult<Pick<Colony, "id" | "system_id" | "body_id" | "status" | "population_tier" | "upkeep_missed_periods" | "abandoned_at">>(coloniesRes).data ?? [];
  const station = maybeSingleResult<PlayerStation>(stationRes).data ?? null;
  const pendingTravelCount = (listResult<Pick<TravelJob, "id">>(pendingJobsRes).data ?? []).length;

  // Station iron
  let stationIron = 0;
  if (station) {
    const { data: ironRow } = await admin
      .from("resource_inventory")
      .select("quantity")
      .eq("location_type", "station")
      .eq("location_id", station.id)
      .eq("resource_type", "iron")
      .maybeSingle();
    stationIron = (ironRow as { quantity: number } | null)?.quantity ?? 0;
  }

  const dockedShips = ships.filter((s) => s.current_system_id !== null);
  const inTransitShips = ships.filter((s) => s.current_system_id === null);
  const activeColonies = colonies.filter((c) => c.status === "active");
  const neglectedColonies = activeColonies.filter((c) => c.upkeep_missed_periods >= 3);
  const abandonedColonies = colonies.filter((c) => c.status === "abandoned");
  const showDev = player.is_dev || process.env.NODE_ENV !== "production";
  const windowMs = BALANCE.inactivity.resolutionWindowDays * 24 * 3_600_000;

  // ── Section header helper ──────────────────────────────────────────────────
  function SectionHead({ icon, label, accent = "bg-indigo-600" }: {
    icon: React.ReactNode; label: string; accent?: string;
  }) {
    return (
      <div className="flex items-center gap-3 mb-3">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${accent.replace("bg-", "bg-").replace("600", "950/80")} border ${accent.replace("bg-", "border-").replace("600", "800/50")}`}>
          {icon}
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">{label}</h2>
        <div className="flex-1 h-px bg-gradient-to-r from-zinc-800 to-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-8">

      {/* ── Hero panel ─────────────────────────────────────────────────────── */}
      <div className="relative rounded-xl border border-indigo-900/40 bg-gradient-to-br from-indigo-950/50 via-zinc-900 to-zinc-900 px-6 py-5 overflow-hidden shadow-lg shadow-black/30 animate-fade-in-up">
        {/* Top accent line */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-500/60 to-transparent" />
        {/* Decorative star cluster */}
        <svg className="absolute right-5 top-4 w-20 h-20 text-indigo-950/60 pointer-events-none select-none" viewBox="0 0 80 80" fill="currentColor" aria-hidden>
          <circle cx="40" cy="40" r="3" opacity="0.8" />
          <circle cx="20" cy="18" r="1.4" opacity="0.5" />
          <circle cx="62" cy="14" r="1.4" opacity="0.5" />
          <circle cx="66" cy="54" r="1.2" opacity="0.4" />
          <circle cx="14" cy="58" r="1" opacity="0.3" />
          <circle cx="50" cy="68" r="1" opacity="0.35" />
          <line x1="40" y1="40" x2="20" y2="18" stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
          <line x1="40" y1="40" x2="62" y2="14" stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
          <line x1="40" y1="40" x2="66" y2="54" stroke="currentColor" strokeWidth="0.4" opacity="0.2" />
          <line x1="40" y1="40" x2="14" y2="58" stroke="currentColor" strokeWidth="0.4" opacity="0.2" />
        </svg>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-700 mb-0.5">Commander</p>
            <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">{player.handle}</h1>
            <p className="mt-1 text-xs text-zinc-600">
              Overview — use the{" "}
              <Link href="/game/map" className="text-indigo-400 hover:text-indigo-300 transition-colors">map</Link>{" "}
              and{" "}
              <Link href="/game/station" className="text-indigo-400 hover:text-indigo-300 transition-colors">station</Link>{" "}
              for gameplay
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-700">Balance</p>
            <p className="mt-0.5 font-mono text-2xl font-bold text-amber-300 tabular-nums">{player.credits.toLocaleString()}</p>
            <p className="text-[10px] text-amber-900 tabular-nums">¢ credits</p>
          </div>
        </div>
      </div>

      {/* ── Abandoned colony alert ─────────────────────────────────────────── */}
      {abandonedColonies.length > 0 && (
        <section className="relative rounded-xl border border-amber-700/60 bg-gradient-to-r from-amber-950/40 via-amber-950/20 to-zinc-900/60 px-4 py-3.5 space-y-2 overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-0.5 bg-amber-600/80 rounded-l-xl" />
          <p className="text-sm font-semibold text-amber-400 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
            </svg>
            {abandonedColonies.length} abandoned {abandonedColonies.length === 1 ? "colony" : "colonies"} — act now to prevent collapse
          </p>
          <div className="space-y-1.5">
            {abandonedColonies.map((colony) => {
              const bodyIdx = colony.body_id.slice(colony.body_id.lastIndexOf(":") + 1);
              const abandonedAt = colony.abandoned_at ? new Date(colony.abandoned_at) : requestTime;
              const collapseAt = new Date(abandonedAt.getTime() + windowMs);
              const msLeft = collapseAt.getTime() - requestTime.getTime();
              const daysLeft = Math.max(0, Math.floor(msLeft / 86_400_000));
              const hoursLeft = Math.max(0, Math.floor((msLeft % 86_400_000) / 3_600_000));
              return (
                <div key={colony.id} className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs text-zinc-300">
                      {systemDisplayName(colony.system_id)}
                      <span className="ml-1 text-zinc-600">· Body {bodyIdx} · T{colony.population_tier}</span>
                    </span>
                    <span className="ml-2 text-xs text-amber-500">
                      {msLeft > 0 ? `collapses in ${daysLeft}d ${hoursLeft}h` : "collapse imminent"}
                    </span>
                  </div>
                  <Link href={`/game/colony/${colony.id}`} className="shrink-0 rounded border border-amber-700/60 bg-amber-900/30 px-2.5 py-0.5 text-xs font-medium text-amber-300 hover:bg-amber-800/40 transition-colors btn-glow-amber">
                    Reactivate →
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Dev controls */}
      {showDev && (
        <section>
          <DevControls pendingTravelCount={pendingTravelCount} stationId={station?.id ?? null} isDev={player.is_dev} />
        </section>
      )}

      {/* ── Asset summary ──────────────────────────────────────────────────── */}
      <section>
        <SectionHead
          accent="bg-zinc-600"
          label="Summary"
          icon={<svg className="w-3 h-3 text-zinc-400" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z"/></svg>}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 stagger-children">
          {/* Credits */}
          <div className="relative rounded-xl border border-amber-900/40 bg-gradient-to-b from-amber-950/20 to-zinc-900 px-4 py-3.5 text-center card-interactive animate-fade-in-up overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Credits</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-amber-300 tabular-nums">{player.credits.toLocaleString()}</p>
          </div>
          {/* Iron */}
          <div className="relative rounded-xl border border-orange-900/30 bg-gradient-to-b from-orange-950/15 to-zinc-900 px-4 py-3.5 text-center card-interactive animate-fade-in-up overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-orange-600/40 to-transparent" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Station Iron</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-orange-300 tabular-nums">{stationIron.toLocaleString()}</p>
          </div>
          {/* Ships */}
          <div className="relative rounded-xl border border-indigo-900/30 bg-gradient-to-b from-indigo-950/15 to-zinc-900 px-4 py-3.5 text-center card-interactive animate-fade-in-up overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Ships</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-zinc-200 tabular-nums">
              {dockedShips.length}
              <span className="text-sm font-normal text-zinc-600"> docked</span>
            </p>
            {inTransitShips.length > 0 && (
              <p className="mt-0.5 text-[10px] text-indigo-400 tabular-nums">+{inTransitShips.length} in transit</p>
            )}
          </div>
          {/* Colonies */}
          <div className={`relative rounded-xl border px-4 py-3.5 text-center card-interactive animate-fade-in-up overflow-hidden ${
            neglectedColonies.length > 0 ? "border-red-900/50 bg-gradient-to-b from-red-950/20 to-zinc-900" : "border-emerald-900/30 bg-gradient-to-b from-emerald-950/10 to-zinc-900"
          }`}>
            <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent ${neglectedColonies.length > 0 ? "via-red-500/50" : "via-emerald-600/40"} to-transparent`} />
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Colonies</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-zinc-200 tabular-nums">
              {activeColonies.length}
              <span className="text-sm font-normal text-zinc-600">/{player.colony_slots >= BALANCE.colony.slotsUnlimited ? "∞" : player.colony_slots}</span>
            </p>
            {neglectedColonies.length > 0 && (
              <p className="mt-0.5 text-[10px] text-red-400">{neglectedColonies.length} neglected</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Station ────────────────────────────────────────────────────────── */}
      {station && (
        <section>
          <SectionHead
            accent="bg-amber-600"
            label="Station"
            icon={<svg className="w-3 h-3 text-amber-400" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M9.669.864 8 0 6.331.864l-1.858.282-.842 1.68-1.337 1.32L2.6 6l-.306 1.854 1.337 1.32.842 1.68 1.858.282L8 12l1.669-.864 1.858-.282.842-1.68 1.337-1.32L13.4 6l.306-1.854-1.337-1.32-.842-1.68L9.669.864zm1.196 1.193.684 1.365 1.086 1.072L12.26 6l.248 1.506-1.086 1.072-.684 1.365-1.51.229L8 11l-1.228-.633-1.51-.229-.684-1.365-1.086-1.072L3.74 6l-.248-1.506 1.086-1.072.684-1.365 1.51-.229L8 1l1.228.633 1.51.229z"/><path d="M8 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2.5 1a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0 0 14A7 7 0 0 0 8 1z"/></svg>}
          />
          <div className="relative rounded-xl border border-amber-900/30 bg-gradient-to-r from-amber-950/20 via-zinc-900 to-zinc-900 px-4 py-3.5 flex items-center justify-between gap-3 card-interactive animate-fade-in-up overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-0.5 bg-amber-700/60 rounded-l-xl" />
            <div className="pl-3">
              <p className="text-sm font-semibold text-zinc-200">{station.name}</p>
              <p className="text-xs text-zinc-600 mt-0.5">{systemDisplayName(station.current_system_id)}</p>
            </div>
            <Link href="/game/station" className="rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-900/50 transition-colors btn-glow-amber shrink-0">
              Manage Station →
            </Link>
          </div>
        </section>
      )}

      {/* ── Ships ──────────────────────────────────────────────────────────── */}
      {ships.length > 0 && (
        <section>
          <SectionHead
            accent="bg-indigo-600"
            label="Ships"
            icon={<svg className="w-3 h-3 text-indigo-400" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M15.528 2.973a.75.75 0 0 1 .472.696v8.662a.75.75 0 0 1-.472.696l-7.25 2.9a.75.75 0 0 1-.557 0l-7.25-2.9A.75.75 0 0 1 0 12.331V3.669a.75.75 0 0 1 .471-.696L7.443.184l.01-.003.268-.108a.75.75 0 0 1 .556 0l.269.108.01.003 6.972 2.789zM1.5 12.331l6.25 2.5V5.53l-1.7-.68L1.5 6.744v5.587zM9.25 14.831l6.25-2.5V6.744l-4.55-1.894L9.25 5.53v9.3zm-6-9.845 4.5 1.8V3.87L7.25 2.65l-4 1.6v.736zm4.5 2.513-4.5-1.8V13.5l4.5-1.8V7.499z"/></svg>}
          />
          <div className="space-y-2 stagger-children">
            {ships.map((ship) => (
              <div key={ship.id} className="flex items-stretch rounded-xl border border-zinc-800 bg-zinc-900/70 overflow-hidden card-interactive animate-fade-in-up">
                <div className={`w-1 shrink-0 ${ship.current_system_id ? "bg-emerald-600/80" : "bg-indigo-600/80"}`} />
                <div className="flex items-center justify-between flex-1 px-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{ship.name}</p>
                    <p className="text-xs text-zinc-600">{ship.current_system_id ? systemDisplayName(ship.current_system_id) : "In transit…"}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                    ship.current_system_id
                      ? "text-emerald-400 border-emerald-900/50 bg-emerald-950/30"
                      : "text-indigo-400 border-indigo-900/50 bg-indigo-950/30"
                  }`}>
                    {ship.current_system_id ? "Docked" : "Traveling"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-700">
            Dispatch from the{" "}
            <Link href="/game/map" className="text-indigo-400 hover:text-indigo-300 transition-colors">map</Link>{" "}
            or{" "}
            <Link href="/game/station" className="text-indigo-400 hover:text-indigo-300 transition-colors">station</Link>.
          </p>
        </section>
      )}

      {/* ── Colonies ───────────────────────────────────────────────────────── */}
      {colonies.length > 0 && (
        <section>
          <SectionHead
            accent="bg-emerald-600"
            label="Colonies"
            icon={<svg className="w-3 h-3 text-emerald-400" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path fillRule="evenodd" d="M8 1a.5.5 0 0 1 .374.167l6 6.5A.5.5 0 0 1 14 8H2a.5.5 0 0 1-.374-.833l6-6.5A.5.5 0 0 1 8 1zm0 1.648L3.276 7h9.448L8 2.648zM5 8h1.5v5H8v-3h1v3h1.5V8H12v6H4V8h1z" clipRule="evenodd"/></svg>}
          />
          <div className="space-y-2 stagger-children">
            {colonies.map((colony) => {
              const bodyIdx = colony.body_id.slice(colony.body_id.lastIndexOf(":") + 1);
              const isNeglected = colony.upkeep_missed_periods >= 3;
              const isStruggling = !isNeglected && colony.upkeep_missed_periods >= 1;
              const stripColor = colony.status === "abandoned" ? "bg-amber-600/80"
                : colony.status === "collapsed" ? "bg-zinc-600/50"
                : isNeglected ? "bg-red-600/80"
                : isStruggling ? "bg-amber-600/60"
                : "bg-emerald-600/70";
              const cardBorder = colony.status === "abandoned" ? "border-amber-800/50 bg-amber-950/10"
                : colony.status === "collapsed" ? "border-zinc-700/50 bg-zinc-900/30 opacity-60"
                : isNeglected ? "border-red-900/50 bg-red-950/10"
                : isStruggling ? "border-amber-900/40 bg-amber-950/5"
                : "border-zinc-800 bg-zinc-900/70";
              return (
                <div key={colony.id} className={`flex items-stretch rounded-xl border overflow-hidden card-interactive animate-fade-in-up ${cardBorder}`}>
                  <div className={`w-1 shrink-0 ${stripColor}`} />
                  <div className="flex items-center justify-between flex-1 px-4 py-2.5 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">
                        {systemDisplayName(colony.system_id)}
                        <span className="ml-1.5 text-xs font-normal text-zinc-600">· Body {bodyIdx} · T{colony.population_tier}</span>
                      </p>
                      {isNeglected && <p className="text-xs text-red-400">Neglected ({colony.upkeep_missed_periods} missed periods)</p>}
                      {isStruggling && <p className="text-xs text-amber-400">Low supplies</p>}
                      {colony.status === "abandoned" && (() => {
                        const abandonedAt = colony.abandoned_at ? new Date(colony.abandoned_at) : requestTime;
                        const msLeft = abandonedAt.getTime() + windowMs - requestTime.getTime();
                        const daysLeft = Math.max(0, Math.floor(msLeft / 86_400_000));
                        const hoursLeft = Math.max(0, Math.floor((msLeft % 86_400_000) / 3_600_000));
                        return <p className="text-xs text-amber-500">Abandoned — {msLeft > 0 ? `collapses in ${daysLeft}d ${hoursLeft}h` : "collapse imminent"}</p>;
                      })()}
                      {colony.status === "collapsed" && <p className="text-xs text-zinc-600">Collapsed</p>}
                    </div>
                    <Link href={`/game/colony/${colony.id}`} className="shrink-0 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap">
                      Details →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Navigate ───────────────────────────────────────────────────────── */}
      <section>
        <SectionHead
          accent="bg-zinc-500"
          label="Navigate"
          icon={<svg className="w-3 h-3 text-zinc-400" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z"/></svg>}
        />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 stagger-children">
          {([
            { href: "/game/map",         label: "Galaxy Map",  from: "from-indigo-950/50",  border: "border-indigo-800/30",  text: "text-indigo-300",  iconBg: "bg-indigo-950/80 border-indigo-800/40",  icon: <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm-.5 2a.5.5 0 0 1 1 0v1a.5.5 0 0 1-1 0V2zm0 3a.5.5 0 0 1 1 0v1a.5.5 0 0 1-1 0V5zm0 3a.5.5 0 0 1 1 0v1a.5.5 0 0 1-1 0V8zm0 3a.5.5 0 0 1 1 0v1a.5.5 0 0 1-1 0v-1zm3-9.5a.5.5 0 0 1 0 1h-1a.5.5 0 0 1 0-1h1zm-3 0a.5.5 0 0 1 0 1h-1a.5.5 0 0 1 0-1h1zm-3 0a.5.5 0 0 1 0 1H4a.5.5 0 0 1 0-1h.5z"/></svg> },
            { href: "/game/station",     label: "Station",     from: "from-amber-950/40",   border: "border-amber-800/30",   text: "text-amber-300",   iconBg: "bg-amber-950/80 border-amber-800/40",   icon: <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M9.669.864 8 0 6.331.864l-1.858.282-.842 1.68-1.337 1.32L2.6 6l-.306 1.854 1.337 1.32.842 1.68 1.858.282L8 12l1.669-.864 1.858-.282.842-1.68 1.337-1.32L13.4 6l.306-1.854-1.337-1.32-.842-1.68L9.669.864z"/></svg> },
            { href: "/game/research",    label: "Research",    from: "from-teal-950/40",    border: "border-teal-800/30",    text: "text-teal-300",    iconBg: "bg-teal-950/80 border-teal-800/40",    icon: <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path fillRule="evenodd" d="M5 1a1 1 0 0 0-1 1v1h-.5A1.5 1.5 0 0 0 2 4.5v.086A2.5 2.5 0 0 0 3 9.293V10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-.707A2.5 2.5 0 0 0 14 4.586V4.5A1.5 1.5 0 0 0 12.5 3H12V2a1 1 0 0 0-1-1H5zm7 4.5H4v-.007A.5.5 0 0 1 4.5 5h7a.5.5 0 0 1 .5.493V5.5zM5 12v2h6v-2H5z" clipRule="evenodd"/></svg> },
            { href: "/game/alliance",    label: "Alliance",    from: "from-violet-950/40",  border: "border-violet-800/30",  text: "text-violet-300",  iconBg: "bg-violet-950/80 border-violet-800/40",  icon: <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M7 14s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1H7zm4-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path fillRule="evenodd" d="M5.216 14A2.238 2.238 0 0 1 5 13c0-1.355.68-2.75 1.936-3.72A6.325 6.325 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1h4.216z" clipRule="evenodd"/><path d="M4.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></svg> },
            { href: "/game/auctions",    label: "Auctions",    from: "from-rose-950/40",    border: "border-rose-800/30",    text: "text-rose-300",    iconBg: "bg-rose-950/80 border-rose-800/40",    icon: <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M9.5 2.672a.5.5 0 1 0 1 0V.843a.5.5 0 0 0-.5-.5H1.5a.5.5 0 0 0-.5.5v7.5a.5.5 0 0 0 .5.5h1.829a.5.5 0 0 0 0-1H2V1.343h7.5v1.329zM1.936 10.88c-.24.023-.42.01-.511-.003a.5.5 0 0 0-.336.186L.5 12.5a.5.5 0 0 0 .5.5H3a.5.5 0 0 0 .354-.854l-.08-.08c-.085-.085-.092-.224-.005-.316l3.51-3.51a1.5 1.5 0 0 0 0-2.121l-.707-.707a1.5 1.5 0 0 0-2.121 0L1.936 6.427l-.707.707a1.5 1.5 0 0 0 0 2.121l.707.707c.023.023.049.044.074.064z"/></svg> },
            { href: "/game/market",      label: "Market",      from: "from-orange-950/40",  border: "border-orange-800/30",  text: "text-orange-300",  iconBg: "bg-orange-950/80 border-orange-800/40",  icon: <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M0 1.5A.5.5 0 0 1 .5 1H2a.5.5 0 0 1 .485.379L2.89 3H14.5a.5.5 0 0 1 .491.592l-1.5 8A.5.5 0 0 1 13 12H4a.5.5 0 0 1-.491-.408L2.01 3.607 1.61 2H.5a.5.5 0 0 1-.5-.5zM5 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg> },
            { href: "/game/shop",        label: "Shop",        from: "from-yellow-950/40",  border: "border-yellow-800/30",  text: "text-yellow-300",  iconBg: "bg-yellow-950/80 border-yellow-800/40",  icon: <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M2.97 1.35A1 1 0 0 1 3.73 1h8.54a1 1 0 0 1 .76.35l2.609 3.044A1.5 1.5 0 0 1 16 5.37v.255a2.375 2.375 0 0 1-4.25 1.458A2.371 2.371 0 0 1 9.875 8 2.37 2.37 0 0 1 8 7.083 2.37 2.37 0 0 1 6.125 8a2.37 2.37 0 0 1-1.875-.917A2.375 2.375 0 0 1 0 5.625V5.37a1.5 1.5 0 0 1 .361-.976L2.97 1.35zm1.267 6.019A1.372 1.372 0 0 0 7.25 6.625v.063a1.373 1.373 0 0 0 2.5 0v-.063a1.372 1.372 0 0 0 2.513-.013c.066.208.101.427.101.638v.13A1.876 1.876 0 0 1 10.5 9h-5A1.876 1.876 0 0 1 3.625 7.25v-.13c0-.21.035-.43.1-.638l.01-.025a1.38 1.38 0 0 0 .502.532z"/><path d="M7.25 11v2.75a.75.75 0 0 1-1.5 0V11h1.5zm2.5 0v2.75a.75.75 0 0 1-1.5 0V11h1.5z"/></svg> },
            { href: "/game/messages",    label: "Messages",    from: "from-sky-950/40",     border: "border-sky-800/30",     text: "text-sky-300",     iconBg: "bg-sky-950/80 border-sky-800/40",     icon: <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4Zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2Zm13 2.383-4.708 2.825L15 11.105V5.383Zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741ZM1 11.105l4.708-2.897L1 5.383v5.722Z"/></svg> },
            { href: "/game/feed",        label: "World Feed",  from: "from-zinc-800/50",    border: "border-zinc-700/40",    text: "text-zinc-300",    iconBg: "bg-zinc-800/80 border-zinc-700/40",    icon: <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M5 3a5 5 0 0 0 0 10h6a5 5 0 0 0 0-10H5zm6 9a4 4 0 1 1 0-8 4 4 0 0 1 0 8H5a4 4 0 1 1 0-8h6z"/></svg> },
            { href: "/game/leaderboard", label: "Leaderboard", from: "from-amber-950/30",   border: "border-amber-800/25",   text: "text-amber-300",   iconBg: "bg-amber-950/80 border-amber-800/40",   icon: <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M2.5.5A.5.5 0 0 1 3 0h10a.5.5 0 0 1 .5.5c0 .538-.012 1.05-.034 1.536a3 3 0 1 1-1.133 5.89c-.79 1.865-1.878 2.777-2.833 3.011v2.173l1.425.356c.194.048.377.135.537.255L13.3 15.1a.5.5 0 0 1-.3.9H3a.5.5 0 0 1-.3-.9l1.838-1.379c.16-.12.343-.207.537-.255L6.5 13.11v-2.173c-.955-.234-2.043-1.146-2.833-3.012a3 3 0 1 1-1.132-5.89A33.076 33.076 0 0 1 2.5.5z"/></svg> },
          ] as { href: string; label: string; from: string; border: string; text: string; iconBg: string; icon: React.ReactNode }[]).map(({ href, label, from, border, text, iconBg, icon }) => (
            <Link
              key={href}
              href={href}
              className={`relative group rounded-xl border ${border} bg-gradient-to-b ${from} to-zinc-900/70 px-3 py-3.5 flex flex-col items-center gap-2.5 card-interactive animate-fade-in-up overflow-hidden`}
            >
              <div className={`w-8 h-8 rounded-lg border ${iconBg} flex items-center justify-center shrink-0 ${text}`}>
                {icon}
              </div>
              <span className={`text-xs font-semibold ${text} text-center leading-tight`}>{label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
