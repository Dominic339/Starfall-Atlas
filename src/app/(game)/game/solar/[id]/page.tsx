/**
 * /game/solar/[id] — Solar System Scene View
 *
 * A visual representation of a single star system, entered via double-click
 * on the galaxy map. Shows:
 *   - Central star (size/color based on spectral class)
 *   - Orbiting planetary bodies with orbital rings
 *   - Player's ships/fleets present in the system
 *   - Player's station if located here
 *   - Player's colonies on specific bodies
 *   - Quick navigation back to the galaxy map
 *
 * Placeholder/simple assets are used where final models are not ready.
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { getCatalogEntry, systemDisplayName } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import type { Player } from "@/lib/types/game";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const name = systemDisplayName(decodeURIComponent(id));
  return { title: `${name} System — Starfall Atlas` };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spectralColor(cls: string): string {
  switch (cls) {
    case "O":
    case "B": return "#93c5fd";
    case "A": return "#bfdbfe";
    case "F": return "#fef3c7";
    case "G": return "#fde68a";
    case "K": return "#fdba74";
    case "M": return "#fca5a5";
    default:  return "#d1d5db";
  }
}

function spectralGlow(cls: string): string {
  switch (cls) {
    case "O":
    case "B": return "#3b82f6";
    case "A": return "#60a5fa";
    case "F": return "#fbbf24";
    case "G": return "#f59e0b";
    case "K": return "#f97316";
    case "M": return "#ef4444";
    default:  return "#6b7280";
  }
}

function starRadius(cls: string): number {
  switch (cls) {
    case "O": return 38;
    case "B": return 32;
    case "A": return 26;
    case "F": return 22;
    case "G": return 20;
    case "K": return 18;
    case "M": return 14;
    default:  return 18;
  }
}

function bodyColor(type: string): string {
  switch (type) {
    case "lush":
    case "habitable":   return "#4ade80";
    case "ocean":       return "#38bdf8";
    case "rocky":       return "#a8a29e";
    case "barren":      return "#78716c";
    case "desert":      return "#fbbf24";
    case "frozen":
    case "ice_planet":  return "#bae6fd";
    case "ice_giant":   return "#7dd3fc";
    case "gas_giant":   return "#fb923c";
    case "volcanic":    return "#f87171";
    case "toxic":       return "#a3e635";
    case "asteroid_belt": return "#6b7280";
    default:            return "#9ca3af";
  }
}

function bodyLabel(type: string): string {
  switch (type) {
    case "lush":        return "Lush";
    case "habitable":   return "Habitable";
    case "ocean":       return "Ocean";
    case "rocky":       return "Rocky";
    case "barren":      return "Barren";
    case "desert":      return "Desert";
    case "frozen":      return "Frozen";
    case "ice_planet":  return "Ice Planet";
    case "ice_giant":   return "Ice Giant";
    case "gas_giant":   return "Gas Giant";
    case "volcanic":    return "Volcanic";
    case "toxic":       return "Toxic";
    case "asteroid_belt": return "Asteroid Belt";
    default:            return type;
  }
}

function bodyRadius(size: string, type: string): number {
  if (type === "asteroid_belt") return 0;
  if (type === "gas_giant" || type === "ice_giant") {
    switch (size) {
      case "tiny":   return 8;
      case "small":  return 10;
      case "medium": return 14;
      case "large":  return 18;
      case "huge":   return 22;
      default:       return 12;
    }
  }
  switch (size) {
    case "tiny":   return 4;
    case "small":  return 6;
    case "medium": return 8;
    case "large":  return 10;
    case "huge":   return 12;
    default:       return 6;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SolarSystemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const systemId = decodeURIComponent(rawId);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const user = await getUser();
  if (!user) redirect("/login");

  // ── Catalog lookup ────────────────────────────────────────────────────────
  const catalogEntry = getCatalogEntry(systemId);
  if (!catalogEntry) notFound();

  // ── Generate system ───────────────────────────────────────────────────────
  const system = generateSystem(systemId, catalogEntry);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("id, handle").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // ── Fetch player assets in this system ────────────────────────────────────
  const [shipsRes, fleetsRes, coloniesRes, stationRes, discoveryRes] = await Promise.all([
    admin
      .from("ships")
      .select("id, name, dispatch_mode, auto_state, cargo_cap, speed_ly_per_hr")
      .eq("owner_id", player.id)
      .eq("current_system_id", systemId),

    admin
      .from("fleets")
      .select("id, name, status")
      .eq("player_id", player.id)
      .eq("current_system_id", systemId)
      .neq("status", "disbanded"),

    admin
      .from("colonies")
      .select("id, body_id, status, population_tier")
      .eq("owner_id", player.id)
      .eq("system_id", systemId)
      .eq("status", "active"),

    admin
      .from("player_stations")
      .select("id, current_system_id")
      .eq("owner_id", player.id)
      .maybeSingle(),

    admin
      .from("system_discoveries")
      .select("system_id, is_first")
      .eq("player_id", player.id)
      .eq("system_id", systemId)
      .maybeSingle(),
  ]);

  type ShipRow = { id: string; name: string; dispatch_mode: string; auto_state: string | null; cargo_cap: number; speed_ly_per_hr: number };
  type FleetRow = { id: string; name: string; status: string };
  type ColonyRow = { id: string; body_id: string; status: string; population_tier: number };

  const ships = (shipsRes.data ?? []) as ShipRow[];
  const fleets = (fleetsRes.data ?? []) as FleetRow[];
  const colonies = (coloniesRes.data ?? []) as ColonyRow[];
  const stationData = stationRes.data as { id: string; current_system_id: string } | null;
  const stationHere = stationData?.current_system_id === systemId;
  const isDiscovered = !!discoveryRes.data;

  // Build set of body indices with colonies
  // body_id format: "{systemId}:{bodyIndex}"
  const colonyByBodyIdx = new Map<number, ColonyRow>();
  for (const colony of colonies) {
    const parts = colony.body_id.split(":");
    const idx = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(idx)) colonyByBodyIdx.set(idx, colony);
  }

  // ── SVG layout constants ──────────────────────────────────────────────────
  const W = 900;
  const H = 600;
  const CX = W / 2;
  const CY = H / 2;
  const starR = starRadius(system.spectralClass);
  const starColor = spectralColor(system.spectralClass);
  const starGlow = spectralGlow(system.spectralClass);

  // Orbital radii — spread planets evenly between starR+40 and CY-30
  const orbitMin = starR + 50;
  const orbitMax = Math.min(CY - 30, CX - 40);
  const bodyCount = system.bodies.length;

  const orbits = system.bodies.map((_, i) => {
    if (bodyCount === 1) return orbitMin + (orbitMax - orbitMin) * 0.4;
    return orbitMin + (orbitMax - orbitMin) * (i / (bodyCount - 1 || 1));
  });

  // Fixed angle per body: distribute around the full circle.
  const bodyAngles = system.bodies.map((_, i) => {
    const step = bodyCount > 1 ? (2 * Math.PI) / bodyCount : 0;
    return -Math.PI / 2 + step * i; // start from top, go clockwise
  });

  // Orbit period per body (seconds): inner planets faster, outer slower (Keplerian-ish).
  const minOrbitR = orbits[0] ?? 1;
  const bodyPeriods = orbits.map((r) => Math.round(12 * Math.pow(r / minOrbitR, 1.5)));

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#06060a]">
      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800/60 bg-zinc-950 px-4 py-2 text-xs">
        <Link
          href="/game/map"
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← Galaxy Map
        </Link>
        <span className="text-zinc-800">/</span>
        <span className="text-zinc-400 font-medium">{system.name}</span>
        <span className="text-zinc-700">{system.spectralClass}-class</span>
        {isDiscovered && <span className="text-emerald-700">Discovered</span>}
        <div className="ml-auto flex items-center gap-3">
          <Link
            href={`/game/system/${encodeURIComponent(systemId)}`}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            System Detail →
          </Link>
        </div>
      </div>

      {/* ── Main layout: SVG + sidebar ──────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* SVG scene */}
        <div className="relative flex-1 overflow-hidden">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-full w-full"
            style={{ background: "#06060a" }}
          >
            <defs>
              <radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={starGlow} stopOpacity="0.5" />
                <stop offset="100%" stopColor={starGlow} stopOpacity="0" />
              </radialGradient>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="softglow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="10" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Background nebula glow */}
            <circle
              cx={CX} cy={CY}
              r={Math.min(CX, CY) * 0.9}
              fill="url(#starGlow)"
            />

            {/* ── Orbital rings ──────────────────────────────────────────────── */}
            {system.bodies.map((body, i) => {
              const orbitR = orbits[i];
              if (body.type === "asteroid_belt") {
                // Dashed ring for asteroid belts
                return (
                  <circle
                    key={`orbit-${i}`}
                    cx={CX} cy={CY}
                    r={orbitR}
                    fill="none"
                    stroke="#6b7280"
                    strokeWidth={3}
                    strokeOpacity={0.35}
                    strokeDasharray="4 4"
                  />
                );
              }
              return (
                <circle
                  key={`orbit-${i}`}
                  cx={CX} cy={CY}
                  r={orbitR}
                  fill="none"
                  stroke="#1f2937"
                  strokeWidth={1}
                  strokeOpacity={0.7}
                />
              );
            })}

            {/* ── Central star ──────────────────────────────────────────────── */}
            {/* Outer glow */}
            <circle
              cx={CX} cy={CY}
              r={starR * 2.5}
              fill={starColor}
              opacity={0.08}
              filter="url(#softglow)"
            />
            {/* Mid glow */}
            <circle
              cx={CX} cy={CY}
              r={starR * 1.6}
              fill={starColor}
              opacity={0.15}
            />
            {/* Main star body */}
            <circle
              cx={CX} cy={CY}
              r={starR}
              fill={starColor}
              filter="url(#glow)"
            />
            {/* Station indicator — top-right of star */}
            {stationHere && (
              <>
                {/* Outer amber ring */}
                <circle cx={CX + starR + 18} cy={CY - starR - 18} r={12}
                  fill="#1c0900" stroke="#f59e0b" strokeWidth={1.5} opacity={0.95} />
                {/* Inner dot */}
                <circle cx={CX + starR + 18} cy={CY - starR - 18} r={6}
                  fill="#f59e0b" opacity={0.95} filter="url(#glow)" />
                {/* "S" label */}
                <text x={CX + starR + 18} y={CY - starR - 18 + 4}
                  textAnchor="middle" fontSize="7" fill="#1c0a00"
                  fontWeight="bold" className="select-none">S</text>
                {/* Station label */}
                <text x={CX + starR + 18} y={CY - starR - 34}
                  textAnchor="middle" fontSize="9" fill="#f59e0b"
                  opacity={0.8} className="select-none">Station</text>
              </>
            )}

            {/* ── Planetary bodies ───────────────────────────────────────────── */}
            {system.bodies.map((body, i) => {
              const orbitR = orbits[i];
              const angle = bodyAngles[i];
              const angleDeg = (angle * 180) / Math.PI;
              // Fixed display position (initial angle, for labels and colony rings)
              const bx = CX + orbitR * Math.cos(angle);
              const by = CY + orbitR * Math.sin(angle);
              const bColor = bodyColor(body.type);
              const bR = bodyRadius(body.size, body.type);
              const colony = colonyByBodyIdx.get(i);
              const period = bodyPeriods[i];

              if (body.type === "asteroid_belt") {
                // Asteroid belt: small dots rotating slowly around the ring
                return (
                  <g key={`body-${i}`}>
                    <g>
                      <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from={`0 ${CX} ${CY}`}
                        to={`360 ${CX} ${CY}`}
                        dur={`${period * 2}s`}
                        repeatCount="indefinite"
                      />
                      {Array.from({ length: 16 }, (_, j) => {
                        const a = (j / 16) * Math.PI * 2;
                        const scatter = (Math.sin(j * 7.3) * 0.07 + 1) * orbitR;
                        return (
                          <circle
                            key={j}
                            cx={CX + scatter * Math.cos(a)}
                            cy={CY + scatter * Math.sin(a)}
                            r={1.5}
                            fill="#9ca3af"
                            opacity={0.5}
                          />
                        );
                      })}
                    </g>
                    <text x={bx} y={by + 14} textAnchor="middle" fontSize="9"
                      fill="#6b7280" opacity={0.7} className="select-none">
                      Belt
                    </text>
                  </g>
                );
              }

              return (
                <g key={`body-${i}`}>
                  {/* Animated planet group — orbits around the star */}
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from={`${angleDeg} ${CX} ${CY}`}
                      to={`${angleDeg + 360} ${CX} ${CY}`}
                      dur={`${period}s`}
                      repeatCount="indefinite"
                    />

                    {/* Colony ring marker */}
                    {colony && (
                      <circle
                        cx={CX + orbitR} cy={CY}
                        r={bR + 6}
                        fill="none"
                        stroke="#34d399"
                        strokeWidth={1.5}
                        opacity={0.85}
                        strokeDasharray="4 3"
                      />
                    )}

                    {/* Station indicator on planet */}
                    {stationHere && colony && (
                      <>
                        <circle cx={CX + orbitR + bR + 8} cy={CY} r={5}
                          fill="none" stroke="#f59e0b" strokeWidth={1.2} opacity={0.85} />
                        <circle cx={CX + orbitR + bR + 8} cy={CY} r={2.5}
                          fill="#f59e0b" opacity={0.85} />
                      </>
                    )}

                    {/* Planet body */}
                    <circle
                      cx={CX + orbitR} cy={CY}
                      r={bR}
                      fill={bColor}
                      stroke="#06060a"
                      strokeWidth={1}
                      opacity={0.92}
                      filter="url(#glow)"
                    />

                    {/* Colony dot on planet surface */}
                    {colony && (
                      <circle
                        cx={CX + orbitR + bR * 0.6} cy={CY - bR * 0.6}
                        r={2.5}
                        fill="#34d399"
                        opacity={0.95}
                      />
                    )}
                  </g>

                  {/* Static label at fixed initial position */}
                  <text
                    x={bx}
                    y={by + bR + 14}
                    textAnchor="middle"
                    fontSize="9"
                    fill={colony ? "#34d399" : "#4b5563"}
                    opacity={0.75}
                    className="select-none"
                  >
                    {i + 1}. {bodyLabel(body.type)}
                    {colony && " ★"}
                  </text>
                </g>
              );
            })}

            {/* ── Ship markers (docked at star — bottom arc) ─────────────────── */}
            {ships.map((ship, i) => {
              const angle = Math.PI + (i - (ships.length - 1) / 2) * 0.30;
              const sx = CX + (starR + 36) * Math.cos(angle);
              const sy = CY + (starR + 36) * Math.sin(angle);
              return (
                <g key={`ship-${ship.id}`}>
                  {/* Outer ring with fill */}
                  <circle cx={sx} cy={sy} r={10} fill="#1e1b4b" stroke="#6366f1" strokeWidth={1.5} opacity={0.95} />
                  {/* Inner ship dot */}
                  <circle cx={sx} cy={sy} r={5.5} fill="#a5b4fc" filter="url(#glow)" />
                  {/* Ship icon */}
                  <text x={sx} y={sy + 2} textAnchor="middle" fontSize="6"
                    fill="#06060a" fontWeight="bold" className="select-none">•</text>
                  {/* Name label */}
                  <text x={sx} y={sy + 20} textAnchor="middle" fontSize="9"
                    fill="#a5b4fc" opacity={0.9} className="select-none">
                    {ship.name}
                  </text>
                  {ship.dispatch_mode !== "manual" && (
                    <text x={sx} y={sy + 30} textAnchor="middle" fontSize="8"
                      fill="#5eead4" opacity={0.7} className="select-none">Auto</text>
                  )}
                </g>
              );
            })}

            {/* ── Fleet markers (docked at star — right arc) ───────────────────── */}
            {fleets.map((fleet, i) => {
              const angle = (i - (fleets.length - 1) / 2) * 0.30;
              const fx = CX + (starR + 36) * Math.cos(angle);
              const fy = CY + (starR + 36) * Math.sin(angle);
              return (
                <g key={`fleet-${fleet.id}`}>
                  {/* Background */}
                  <circle cx={fx} cy={fy} r={10} fill="#1a0a3d" stroke="#a78bfa" strokeWidth={1.5} opacity={0.95} />
                  {/* Fleet triangle */}
                  <polygon
                    points={`${fx},${fy - 5.5} ${fx + 5},${fy + 3.5} ${fx - 5},${fy + 3.5}`}
                    fill="#c4b5fd"
                    filter="url(#glow)"
                  />
                  {/* Name label */}
                  <text x={fx} y={fy + 20} textAnchor="middle" fontSize="9"
                    fill="#c4b5fd" opacity={0.9} className="select-none">
                    {fleet.name}
                  </text>
                  {fleet.status === "harvesting" && (
                    <text x={fx} y={fy + 30} textAnchor="middle" fontSize="8"
                      fill="#fcd34d" opacity={0.7} className="select-none">Harvesting</text>
                  )}
                </g>
              );
            })}

            {/* ── System name label ──────────────────────────────────────────── */}
            <text
              x={20} y={H - 20}
              fontSize="11"
              fill="#3f3f5a"
              className="select-none"
            >
              {system.name} · {system.spectralClass}-class · {system.bodyCount} bodies
            </text>
          </svg>
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
        <div className="flex w-64 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950 text-xs overflow-y-auto">

          {/* System header */}
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ background: starColor }}
              />
              <h2 className="font-semibold text-zinc-200 truncate">{system.name}</h2>
            </div>
            <p className="mt-0.5 text-zinc-600">{system.spectralClass}-class · {system.bodyCount} bodies</p>
            {!isDiscovered && (
              <p className="mt-1 text-zinc-700">Not yet discovered</p>
            )}
          </div>

          {/* Station */}
          {stationHere && (
            <div className="border-b border-zinc-800/50 px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400 opacity-80" />
                <span className="text-amber-400 font-medium">Your Station</span>
              </div>
              <Link
                href="/game/station"
                className="mt-1 block text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                View station inventory →
              </Link>
            </div>
          )}

          {/* Ships */}
          {ships.length > 0 && (
            <div className="border-b border-zinc-800/50 px-4 py-2">
              <p className="mb-1.5 text-zinc-600 uppercase tracking-wider text-xs">
                Ships ({ships.length})
              </p>
              <div className="space-y-1">
                {ships.map((ship) => (
                  <div key={ship.id} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
                    <span className="truncate text-zinc-300">{ship.name}</span>
                    {ship.dispatch_mode !== "manual" && (
                      <span className="shrink-0 text-teal-600 text-xs">Auto</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fleets */}
          {fleets.length > 0 && (
            <div className="border-b border-zinc-800/50 px-4 py-2">
              <p className="mb-1.5 text-zinc-600 uppercase tracking-wider text-xs">
                Fleets ({fleets.length})
              </p>
              <div className="space-y-1">
                {fleets.map((fleet) => (
                  <div key={fleet.id} className="flex items-center gap-2">
                    <span className="h-0 w-0 shrink-0 border-4 border-transparent" style={{ borderBottomColor: "#a78bfa", borderBottomWidth: 5 }} />
                    <span className="truncate text-zinc-300">{fleet.name}</span>
                    <Link
                      href={`/game/fleet/${fleet.id}`}
                      className="ml-auto shrink-0 text-zinc-700 hover:text-zinc-400 transition-colors"
                    >
                      →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Colonies */}
          {colonies.length > 0 && (
            <div className="border-b border-zinc-800/50 px-4 py-2">
              <p className="mb-1.5 text-zinc-600 uppercase tracking-wider text-xs">
                Colonies ({colonies.length})
              </p>
              <div className="space-y-1">
                {colonies.map((colony) => {
                  const parts = colony.body_id.split(":");
                  const idx = parseInt(parts[parts.length - 1], 10);
                  const body = !isNaN(idx) ? system.bodies[idx] : null;
                  return (
                    <div key={colony.id} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="truncate text-zinc-300">
                        Body {!isNaN(idx) ? idx + 1 : "?"}{body ? ` · ${bodyLabel(body.type)}` : ""}
                      </span>
                      <Link
                        href={`/game/colony/${colony.id}`}
                        className="ml-auto shrink-0 text-zinc-700 hover:text-zinc-400 transition-colors"
                      >
                        →
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bodies list */}
          <div className="px-4 py-2">
            <p className="mb-1.5 text-zinc-600 uppercase tracking-wider text-xs">Bodies</p>
            <div className="space-y-1">
              {system.bodies.map((body, i) => {
                const colony = colonyByBodyIdx.get(i);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: bodyColor(body.type) }}
                    />
                    <span className="text-zinc-500">
                      {i + 1}. {bodyLabel(body.type)}
                    </span>
                    <span className="ml-auto text-zinc-700">{body.size}</span>
                    {colony && (
                      <span className="text-emerald-500">★</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-auto border-t border-zinc-800 p-4 space-y-2">
            <Link
              href={`/game/system/${encodeURIComponent(systemId)}`}
              className="block w-full rounded border border-zinc-700 px-3 py-2 text-center text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
            >
              System Actions →
            </Link>
            <Link
              href="/game/map"
              className="block w-full rounded border border-zinc-800 px-3 py-2 text-center text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              ← Back to Galaxy Map
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
