import { BALANCE } from "@/lib/config/balance";

const B = BALANCE.influence;

export interface InfluenceSnapshot {
  playerId: string;
  influence: number;
  colonyCount: number;
}

export interface MajorityResult {
  /** Player who made the claim (or lead member for alliance majority). */
  controllerId: string;
  allianceId: string | null;
  influenceShare: number;
  colonyCount: number;
}

/**
 * Recomputes per-player influence for all active players in a system and
 * upserts into system_influence_cache. Returns the fresh snapshots.
 *
 * Formula (GAME_RULES.md §4.3 / BALANCE.influence):
 *   per colony : population_tier × colonyPerTierWeight
 *   per active non-extractor structure : structureWeight
 *   per active extractor              : extractorWeight
 *   gate owner bonus                  : gateOwnerBonus (once per system)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refreshInfluenceCache(admin: any, systemId: string): Promise<InfluenceSnapshot[]> {
  const { data: coloniesRaw } = await admin
    .from("colonies")
    .select("id, owner_id, population_tier")
    .eq("system_id", systemId)
    .eq("status", "active");

  const colonies = (coloniesRaw ?? []) as { id: string; owner_id: string; population_tier: number }[];

  const influenceMap = new Map<string, { influence: number; colonyCount: number }>();

  if (colonies.length > 0) {
    const colonyIds = colonies.map((c) => c.id);

    const { data: structuresRaw } = await admin
      .from("structures")
      .select("owner_id, type")
      .in("colony_id", colonyIds)
      .eq("is_active", true);

    const structures = (structuresRaw ?? []) as { owner_id: string; type: string }[];

    const { data: gateRaw } = await admin
      .from("hyperspace_gates")
      .select("owner_id")
      .eq("system_id", systemId)
      .eq("status", "active")
      .maybeSingle();
    const gateOwnerId = (gateRaw as { owner_id: string } | null)?.owner_id ?? null;

    for (const c of colonies) {
      const cur = influenceMap.get(c.owner_id) ?? { influence: 0, colonyCount: 0 };
      cur.influence += c.population_tier * B.colonyPerTierWeight;
      cur.colonyCount += 1;
      influenceMap.set(c.owner_id, cur);
    }

    for (const s of structures) {
      const weight = s.type === "extractor" ? B.extractorWeight : B.structureWeight;
      const cur = influenceMap.get(s.owner_id) ?? { influence: 0, colonyCount: 0 };
      cur.influence += weight;
      influenceMap.set(s.owner_id, cur);
    }

    if (gateOwnerId) {
      const cur = influenceMap.get(gateOwnerId) ?? { influence: 0, colonyCount: 0 };
      cur.influence += B.gateOwnerBonus;
      influenceMap.set(gateOwnerId, cur);
    }
  }

  // Replace cache atomically (delete-then-insert is fine for a soft cache).
  await admin.from("system_influence_cache").delete().eq("system_id", systemId);

  const snapshots: InfluenceSnapshot[] = Array.from(influenceMap.entries()).map(
    ([playerId, d]) => ({ playerId, influence: d.influence, colonyCount: d.colonyCount }),
  );

  if (snapshots.length > 0) {
    const now = new Date().toISOString();
    await admin.from("system_influence_cache").insert(
      snapshots.map((s) => ({
        system_id:    systemId,
        player_id:    s.playerId,
        influence:    s.influence,
        colony_count: s.colonyCount,
        computed_at:  now,
      })),
    );
  }

  return snapshots;
}

/**
 * Given fresh influence snapshots, returns the majority result if any
 * player (or alliance) holds >50% with ≥ majorityThresholdMinColonies colonies.
 *
 * Individual player majority is checked first; then alliance majority if
 * allianceMembership is provided.
 */
export function detectMajority(
  snapshots: InfluenceSnapshot[],
  allianceMembership?: Map<string, string>, // playerId → allianceId
): MajorityResult | null {
  if (snapshots.length === 0) return null;

  const total = snapshots.reduce((s, e) => s + e.influence, 0);
  if (total === 0) return null;

  for (const s of snapshots) {
    const share = s.influence / total;
    if (share > 0.5 && s.colonyCount >= B.majorityThresholdMinColonies) {
      return {
        controllerId:   s.playerId,
        allianceId:     allianceMembership?.get(s.playerId) ?? null,
        influenceShare: share,
        colonyCount:    s.colonyCount,
      };
    }
  }

  if (!allianceMembership) return null;

  // Alliance-level check: aggregate member influence per alliance.
  const allianceMap = new Map<string, { influence: number; colonyCount: number; leaderId: string }>();
  for (const s of snapshots) {
    const aid = allianceMembership.get(s.playerId);
    if (!aid) continue;
    const cur = allianceMap.get(aid) ?? { influence: 0, colonyCount: 0, leaderId: s.playerId };
    cur.influence   += s.influence;
    cur.colonyCount += s.colonyCount;
    allianceMap.set(aid, cur);
  }

  for (const [aid, data] of allianceMap.entries()) {
    const share = data.influence / total;
    if (share > 0.5 && data.colonyCount >= B.majorityThresholdMinColonies) {
      return {
        controllerId:   data.leaderId,
        allianceId:     aid,
        influenceShare: share,
        colonyCount:    data.colonyCount,
      };
    }
  }

  return null;
}

/**
 * Lazy revert: if majority control has been in a contested (is_confirmed=false)
 * state for longer than contestedRevertHours, restore governance to the steward
 * and remove the majority control record.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkContestedRevert(admin: any, systemId: string): Promise<void> {
  const { data: mcRow } = await admin
    .from("system_majority_control")
    .select("id, is_confirmed, updated_at, controller_id")
    .eq("system_id", systemId)
    .maybeSingle();

  if (!mcRow || (mcRow as { is_confirmed: boolean }).is_confirmed) return;

  const row = mcRow as { id: string; is_confirmed: boolean; updated_at: string; controller_id: string };
  const revertAt = new Date(
    new Date(row.updated_at).getTime() + B.contestedRevertHours * 3_600_000,
  );
  if (new Date() < revertAt) return;

  // Contested too long — restore steward governance.
  await admin.from("system_majority_control").delete().eq("system_id", systemId);
  await admin.from("system_stewardship").update({ has_governance: true }).eq("system_id", systemId);

  const { data: stewardRow } = await admin
    .from("system_stewardship")
    .select("steward_id")
    .eq("system_id", systemId)
    .maybeSingle();

  await admin.from("world_events").insert({
    event_type: "majority_control_lost",
    player_id:  (stewardRow as { steward_id: string } | null)?.steward_id ?? null,
    system_id:  systemId,
    metadata:   { reason: "contested_revert" },
  });
}
