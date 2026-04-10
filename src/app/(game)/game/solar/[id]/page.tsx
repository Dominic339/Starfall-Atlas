/**
 * /game/solar/[id] — Solar System 3D Scene
 *
 * Server component that fetches all required data, then hands it to the
 * SolarScene client component which renders the Three.js canvas.
 *
 * Layout:
 *   - Top nav bar (breadcrumb + links)
 *   - Three.js canvas (flex-1, fills remaining space)
 *   - Right sidebar (player assets + body list)
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maybeSingleResult } from "@/lib/supabase/utils";
import { getCatalogEntry, systemDisplayName } from "@/lib/catalog";
import { generateSystem } from "@/lib/game/generation";
import type { Player } from "@/lib/types/game";
import dynamic from "next/dynamic";
import type {
  SolarSceneSystemData,
  SolarSceneShipData,
  SolarSceneFleetData,
} from "./_components/SolarScene";

const SolarScene = dynamic(
  () => import("./_components/SolarScene").then((m) => ({ default: m.SolarScene })),
  { ssr: false },
);

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
// Small display helpers (sidebar only — no SVG)
// ---------------------------------------------------------------------------

function spectralDotColor(cls: string): string {
  switch (cls) {
    case "O": case "B": return "#93c5fd";
    case "A":           return "#bfdbfe";
    case "F":           return "#fef3c7";
    case "G":           return "#fde68a";
    case "K":           return "#fdba74";
    case "M":           return "#fca5a5";
    default:            return "#d1d5db";
  }
}

function bodyDisplayLabel(type: string): string {
  const labels: Record<string, string> = {
    lush: "Lush", habitable: "Habitable", ocean: "Ocean", rocky: "Rocky",
    barren: "Barren", desert: "Desert", frozen: "Frozen", ice_planet: "Ice Planet",
    ice_giant: "Ice Giant", gas_giant: "Gas Giant", volcanic: "Volcanic",
    toxic: "Toxic", asteroid_belt: "Asteroid Belt",
  };
  return labels[type] ?? type;
}

function bodyDotColor(type: string): string {
  const colors: Record<string, string> = {
    lush: "#4ade80", habitable: "#86efac", ocean: "#38bdf8",
    rocky: "#a8a29e", barren: "#78716c", desert: "#fbbf24",
    frozen: "#bae6fd", ice_planet: "#7dd3fc", ice_giant: "#67e8f9",
    gas_giant: "#fb923c", volcanic: "#f87171", toxic: "#a3e635",
    asteroid_belt: "#6b7280",
  };
  return colors[type] ?? "#9ca3af";
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

  // ── Catalog ───────────────────────────────────────────────────────────────
  const catalogEntry = getCatalogEntry(systemId);
  if (!catalogEntry) notFound();

  const system = generateSystem(systemId, catalogEntry);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: player } = maybeSingleResult<Player>(
    await admin.from("players").select("id, handle").eq("auth_id", user.id).maybeSingle(),
  );
  if (!player) redirect("/login");

  // ── Player assets in this system ──────────────────────────────────────────
  const [shipsRes, fleetsRes, coloniesRes, stationRes, discoveryRes] =
    await Promise.all([
      admin
        .from("ships")
        .select("id, name, dispatch_mode")
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

  type ShipRow    = { id: string; name: string; dispatch_mode: string };
  type FleetRow   = { id: string; name: string; status: string };
  type ColonyRow  = { id: string; body_id: string; status: string; population_tier: number };

  const ships       = (shipsRes.data   ?? []) as ShipRow[];
  const fleets      = (fleetsRes.data  ?? []) as FleetRow[];
  const colonies    = (coloniesRes.data ?? []) as ColonyRow[];
  const stationData = stationRes.data  as { id: string; current_system_id: string } | null;
  const stationHere = stationData?.current_system_id === systemId;
  const isDiscovered = !!discoveryRes.data;

  // Derive the set of body indices that have active colonies
  // body_id format: "{systemId}:{bodyIndex}"
  const coloniesBodyIndices: number[] = [];
  const colonyByBodyIdx = new Map<number, ColonyRow>();
  for (const colony of colonies) {
    const parts = colony.body_id.split(":");
    const idx   = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(idx)) {
      coloniesBodyIndices.push(idx);
      colonyByBodyIdx.set(idx, colony);
    }
  }

  // ── Serialise system data for client component ────────────────────────────
  const sceneSystem: SolarSceneSystemData = {
    name:          system.name,
    spectralClass: system.spectralClass,
    bodies: system.bodies.map((b) => ({
      type: b.type,
      size: b.size,
    })),
  };

  const sceneShips: SolarSceneShipData[] = ships.map((s) => ({
    id:            s.id,
    name:          s.name,
    dispatch_mode: s.dispatch_mode,
  }));

  const sceneFleets: SolarSceneFleetData[] = fleets.map((f) => ({
    id:     f.id,
    name:   f.name,
    status: f.status,
  }));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#06060a]">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
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
        {isDiscovered && (
          <span className="text-emerald-700">Discovered</span>
        )}
        <div className="ml-auto">
          <Link
            href={`/game/system/${encodeURIComponent(systemId)}`}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            System Detail →
          </Link>
        </div>
      </div>

      {/* ── Main layout: 3D scene + sidebar ──────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* 3D canvas */}
        <div className="relative flex-1 overflow-hidden">
          <SolarScene
            system={sceneSystem}
            ships={sceneShips}
            fleets={sceneFleets}
            coloniesBodyIndices={coloniesBodyIndices}
            stationHere={stationHere}
          />
          {/* Overlay hint */}
          <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-zinc-700 select-none">
            Drag to orbit · Scroll to zoom
          </p>
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <div className="flex w-64 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950 text-xs overflow-y-auto">

          {/* System header */}
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ background: spectralDotColor(system.spectralClass) }}
              />
              <h2 className="font-semibold text-zinc-200 truncate">
                {system.name}
              </h2>
            </div>
            <p className="mt-0.5 text-zinc-600">
              {system.spectralClass}-class · {system.bodyCount} bodies
            </p>
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
              <p className="mb-1.5 text-zinc-600 uppercase tracking-wider">
                Ships ({ships.length})
              </p>
              <div className="space-y-1">
                {ships.map((ship) => (
                  <div key={ship.id} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
                    <span className="truncate text-zinc-300">{ship.name}</span>
                    {ship.dispatch_mode !== "manual" && (
                      <span className="shrink-0 text-teal-600">Auto</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fleets */}
          {fleets.length > 0 && (
            <div className="border-b border-zinc-800/50 px-4 py-2">
              <p className="mb-1.5 text-zinc-600 uppercase tracking-wider">
                Fleets ({fleets.length})
              </p>
              <div className="space-y-1">
                {fleets.map((fleet) => (
                  <div key={fleet.id} className="flex items-center gap-2">
                    <span
                      className="h-0 w-0 shrink-0 border-4 border-transparent"
                      style={{ borderBottomColor: "#a78bfa", borderBottomWidth: 5 }}
                    />
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
              <p className="mb-1.5 text-zinc-600 uppercase tracking-wider">
                Colonies ({colonies.length})
              </p>
              <div className="space-y-1">
                {colonies.map((colony) => {
                  const parts = colony.body_id.split(":");
                  const idx   = parseInt(parts[parts.length - 1], 10);
                  const body  = !isNaN(idx) ? system.bodies[idx] : null;
                  return (
                    <div key={colony.id} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="truncate text-zinc-300">
                        Body {!isNaN(idx) ? idx + 1 : "?"}
                        {body ? ` · ${bodyDisplayLabel(body.type)}` : ""}
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
            <p className="mb-1.5 text-zinc-600 uppercase tracking-wider">
              Bodies
            </p>
            <div className="space-y-1">
              {system.bodies.map((body, i) => {
                const colony = colonyByBodyIdx.get(i);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: bodyDotColor(body.type) }}
                    />
                    <span className="text-zinc-500">
                      {i + 1}. {bodyDisplayLabel(body.type)}
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
