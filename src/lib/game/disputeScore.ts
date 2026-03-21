/**
 * Dispute score computation (Phase 25).
 *
 * Provides a deterministic, centralized scoring formula for fleet commitment
 * to beacon disputes.  Score is computed once at commit time and frozen in
 * dispute_reinforcements.score_snapshot so lazy resolution never recomputes.
 *
 * Formula (per ship):
 *   score += turret_level  × BALANCE.disputes.scoreWeights.turret
 *   score += hull_level    × BALANCE.disputes.scoreWeights.hull
 *   score += shield_level  × BALANCE.disputes.scoreWeights.shield
 *
 * Total fleet score = sum across all ships in the fleet.
 */

import { BALANCE } from "@/lib/config/balance";

export interface ShipStats {
  turret_level: number;
  hull_level:   number;
  shield_level: number;
}

/**
 * Compute the dispute score for a list of ships.
 * Returns 0 for an empty fleet (minimum commitment).
 */
export function computeFleetDisputeScore(ships: ShipStats[]): number {
  const { turret, hull, shield } = BALANCE.disputes.scoreWeights;
  let total = 0;
  for (const s of ships) {
    total +=
      s.turret_level * turret +
      s.hull_level   * hull   +
      s.shield_level * shield;
  }
  return total;
}
