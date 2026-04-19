/**
 * Gate and lane construction job resolution.
 *
 * Called lazily on any page load that cares about gate/lane state.
 * Pattern mirrors travelResolution: fetch pending jobs → if complete_at ≤ now → activate.
 */

import type { HyperspaceGate, HyperspaceLane } from "@/lib/types/game";

// ---------------------------------------------------------------------------
// Resolve gate construction jobs for a single player
// ---------------------------------------------------------------------------

export async function resolveGateJobs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  playerId: string,
  now: Date,
): Promise<number> {
  // Fetch pending gate jobs for this player that are due
  const { data: jobs } = await admin
    .from("gate_construction_jobs")
    .select("id, gate_id")
    .eq("player_id", playerId)
    .eq("status", "pending")
    .lte("complete_at", now.toISOString());

  if (!jobs || jobs.length === 0) return 0;

  const gateIds = jobs.map((j: { gate_id: string }) => j.gate_id);
  const jobIds  = jobs.map((j: { id: string }) => j.id);

  // Activate the gates
  await admin
    .from("hyperspace_gates")
    .update({ status: "active", built_at: now.toISOString() })
    .in("id", gateIds)
    .eq("status", "inactive");

  // Also handle reclaims: gates that are neutral when a reclaim job completes
  // keep owner_id as-is (set during reclaim route), just flip to active
  await admin
    .from("hyperspace_gates")
    .update({ status: "active", reclaimed_at: now.toISOString() })
    .in("id", gateIds)
    .eq("status", "neutral");

  // Mark jobs complete
  await admin
    .from("gate_construction_jobs")
    .update({ status: "complete" })
    .in("id", jobIds);

  return jobs.length;
}

// ---------------------------------------------------------------------------
// Resolve lane construction jobs for a single player
// ---------------------------------------------------------------------------

export async function resolveLaneJobs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  playerId: string,
  now: Date,
): Promise<number> {
  const { data: jobs } = await admin
    .from("lane_construction_jobs")
    .select("id, lane_id")
    .eq("player_id", playerId)
    .eq("status", "pending")
    .lte("complete_at", now.toISOString());

  if (!jobs || jobs.length === 0) return 0;

  const laneIds = jobs.map((j: { lane_id: string }) => j.lane_id);
  const jobIds  = jobs.map((j: { id: string }) => j.id);

  await admin
    .from("hyperspace_lanes")
    .update({ is_active: true, built_at: now.toISOString() })
    .in("id", laneIds);

  await admin
    .from("lane_construction_jobs")
    .update({ status: "complete" })
    .in("id", jobIds);

  return jobs.length;
}

// ---------------------------------------------------------------------------
// Fetch active gate for a system (null if none)
// ---------------------------------------------------------------------------

export async function getActiveGate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  systemId: string,
): Promise<HyperspaceGate | null> {
  const { data } = await admin
    .from("hyperspace_gates")
    .select("*")
    .eq("system_id", systemId)
    .eq("status", "active")
    .maybeSingle();
  return (data as HyperspaceGate | null) ?? null;
}

// ---------------------------------------------------------------------------
// Fetch active lane between two systems (either direction, player-accessible)
// ---------------------------------------------------------------------------

export async function findActiveLane(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  fromSystemId: string,
  toSystemId: string,
  playerId: string,
  playerAllianceId: string | null,
): Promise<HyperspaceLane | null> {
  // Lanes are directed (from_system_id → to_system_id). Check both directions.
  const { data: rows } = await admin
    .from("hyperspace_lanes")
    .select("*")
    .eq("is_active", true)
    .or(
      `and(from_system_id.eq.${fromSystemId},to_system_id.eq.${toSystemId}),` +
      `and(from_system_id.eq.${toSystemId},to_system_id.eq.${fromSystemId})`,
    );

  if (!rows || rows.length === 0) return null;

  const now = Date.now();
  for (const lane of rows as (HyperspaceLane & { expires_at?: string | null; is_one_way?: boolean })[]) {
    // Skip expired warp tunnels
    if (lane.expires_at && new Date(lane.expires_at).getTime() <= now) continue;
    // One-way lanes: only usable from_system_id → to_system_id
    if (lane.is_one_way && lane.from_system_id !== fromSystemId) continue;

    if (lane.access_level === "public") return lane;
    if (lane.access_level === "private" && lane.owner_id === playerId) return lane;
    if (lane.access_level === "alliance_only" && playerAllianceId && lane.alliance_id === playerAllianceId) return lane;
  }

  return null;
}
