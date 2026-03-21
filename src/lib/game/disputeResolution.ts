/**
 * Lazy dispute resolution (Phase 25).
 *
 * Called on page loads (map, alliance, beacon) to resolve any disputes whose
 * resolves_at has passed.  Returns after resolving all overdue disputes.
 *
 * Resolution logic:
 *   1. Find all 'open' disputes where resolves_at <= NOW().
 *   2. For each: sum score_snapshot per alliance from active reinforcements.
 *   3. Determine winner:
 *        - If attacker score > defender score → transfer beacon to attacker
 *        - Otherwise defender retains the beacon
 *        - Tie goes to the defender
 *   4. Apply 48-hour cooldown to the disputed beacon (and direct neighbor beacons
 *      within BALANCE.disputes.cooldownNeighborhoodLinks beacon-link hops).
 *   5. Release all committed fleets (set is_active = false, clear dispute_commit_id).
 *   6. Mark dispute as 'resolved' (or 'expired' if no reinforcements).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

import { BALANCE } from "@/lib/config/balance";
import { getAllCatalogEntries } from "@/lib/catalog";
import { distanceBetween } from "@/lib/game/travel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DisputeRow {
  id: string;
  beacon_id: string;
  defending_alliance_id: string;
  attacking_alliance_id: string;
  resolves_at: string;
}

interface ReinforcementRow {
  id: string;
  alliance_id: string;
  fleet_id: string;
  score_snapshot: number;
}

interface BeaconRow {
  id: string;
  alliance_id: string;
  system_id: string;
}

// ---------------------------------------------------------------------------
// Neighbor beacons within N link hops
// ---------------------------------------------------------------------------

/**
 * Returns the system_ids of beacons (same alliance) that are within
 * BALANCE.disputes.cooldownNeighborhoodLinks direct beacon-link hops from
 * the disputed beacon's system.
 *
 * A "link" exists between two beacons of the same alliance when their
 * 2D catalog-space distance is ≤ BALANCE.alliance.beaconLinkMaxDistanceLy.
 */
function findNeighborBeaconIds(
  disputedBeacon: BeaconRow,
  allBeacons: BeaconRow[],
): string[] {
  const maxDist   = BALANCE.alliance.beaconLinkMaxDistanceLy;
  const maxHops   = BALANCE.disputes.cooldownNeighborhoodLinks;
  const catalog   = getAllCatalogEntries();
  const coordsMap = new Map(catalog.map((e) => [e.id, { x: e.x, y: e.y, z: e.z }]));

  const allianceBeacons = allBeacons.filter(
    (b) => b.alliance_id === disputedBeacon.alliance_id && b.id !== disputedBeacon.id,
  );

  const disputedCoords = coordsMap.get(disputedBeacon.system_id);
  if (!disputedCoords) return [];

  const neighborIds: string[] = [];
  for (const b of allianceBeacons) {
    const coords = coordsMap.get(b.system_id);
    if (!coords) continue;
    // For maxHops = 1, we only need direct neighbors
    const dist = distanceBetween(disputedCoords, coords);
    if (dist <= maxDist * maxHops) {
      neighborIds.push(b.id);
    }
  }
  return neighborIds;
}

// ---------------------------------------------------------------------------
// Main resolution function
// ---------------------------------------------------------------------------

/**
 * Resolve all overdue disputes.
 * Safe to call on every page load; exits quickly if nothing is overdue.
 */
export async function resolveOverdueDisputes(admin: AdminClient): Promise<void> {
  const now = new Date().toISOString();

  // 1. Find open disputes past their deadline
  const { data: overdueRows, error } = await admin
    .from("disputes")
    .select("id, beacon_id, defending_alliance_id, attacking_alliance_id, resolves_at")
    .eq("status", "open")
    .lte("resolves_at", now);

  if (error || !overdueRows || overdueRows.length === 0) return;

  const overdueDisputes: DisputeRow[] = overdueRows;

  for (const dispute of overdueDisputes) {
    await resolveSingleDispute(admin, dispute, now);
  }
}

async function resolveSingleDispute(
  admin: AdminClient,
  dispute: DisputeRow,
  resolvedAt: string,
): Promise<void> {
  // 2. Fetch all active reinforcements for this dispute
  const { data: reinforcements } = await admin
    .from("dispute_reinforcements")
    .select("id, alliance_id, fleet_id, score_snapshot")
    .eq("dispute_id", dispute.id)
    .eq("is_active", true);

  const rRows: ReinforcementRow[] = reinforcements ?? [];

  // 3. Tally scores
  let defenderScore = 0;
  let attackerScore = 0;
  for (const r of rRows) {
    if (r.alliance_id === dispute.defending_alliance_id) {
      defenderScore += r.score_snapshot;
    } else if (r.alliance_id === dispute.attacking_alliance_id) {
      attackerScore += r.score_snapshot;
    }
  }

  // Determine winner (tie → defender keeps beacon)
  const attackerWins = attackerScore > defenderScore;
  const winnerAllianceId = attackerWins
    ? dispute.attacking_alliance_id
    : dispute.defending_alliance_id;

  // 4a. If attacker wins, transfer the beacon
  if (attackerWins) {
    await admin
      .from("alliance_beacons")
      .update({ alliance_id: dispute.attacking_alliance_id })
      .eq("id", dispute.beacon_id);
  }

  // 4b. Apply cooldowns to the disputed beacon and its neighbors
  const beaconIds = [dispute.beacon_id];

  // Fetch all active beacons from the defending alliance to find neighbors
  const { data: allianceBeacons } = await admin
    .from("alliance_beacons")
    .select("id, alliance_id, system_id")
    .eq("alliance_id", dispute.defending_alliance_id)
    .eq("is_active", true);

  const allBeacons: BeaconRow[] = allianceBeacons ?? [];
  const disputedBeacon = allBeacons.find((b) => b.id === dispute.beacon_id);
  if (disputedBeacon) {
    const neighborIds = findNeighborBeaconIds(disputedBeacon, allBeacons);
    beaconIds.push(...neighborIds);
  }

  const cooldownExpiry = new Date(
    new Date(resolvedAt).getTime() + BALANCE.disputes.cooldownHours * 60 * 60 * 1000,
  ).toISOString();

  // Upsert cooldowns (use ON CONFLICT via delete+insert pattern)
  for (const beaconId of beaconIds) {
    // Delete existing cooldowns for this beacon first
    await admin.from("beacon_cooldowns").delete().eq("beacon_id", beaconId);

    await admin.from("beacon_cooldowns").insert({
      beacon_id:  beaconId,
      dispute_id: dispute.id,
      expires_at: cooldownExpiry,
    });
  }

  // 5. Release all committed fleets
  const fleetIds = rRows.map((r) => r.fleet_id);
  if (fleetIds.length > 0) {
    await admin
      .from("fleets")
      .update({ dispute_commit_id: null })
      .in("id", fleetIds);
  }

  // Deactivate reinforcement rows
  await admin
    .from("dispute_reinforcements")
    .update({ is_active: false })
    .eq("dispute_id", dispute.id);

  // 6. Mark dispute resolved
  const newStatus = rRows.length === 0 ? "expired" : "resolved";
  await admin
    .from("disputes")
    .update({
      status:             newStatus,
      resolved_at:        resolvedAt,
      winner_alliance_id: newStatus === "resolved" ? winnerAllianceId : null,
    })
    .eq("id", dispute.id);
}
