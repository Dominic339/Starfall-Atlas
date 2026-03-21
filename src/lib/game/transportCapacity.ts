/**
 * Colony transport capacity helpers — Phase 18.
 *
 * Each colony transport row has a tier (1–5). The total capacity of a colony's
 * transport pool is the sum of capacityPerTier[tier] for each transport row.
 *
 * Route resolution caps the per-period transfer at this total capacity.
 * Multiple lower-tier transports are additive; upgrading a transport to a
 * higher tier increases its individual contribution.
 */

import { BALANCE } from "@/lib/config/balance";

/** Minimal transport descriptor needed for capacity calculations. */
export interface TransportCapacityRow {
  tier: number;
}

/**
 * Total capacity (units per route period) for a colony given its transport rows.
 * Returns 0 when the colony has no transports (routes are gated at 0).
 */
export function colonyTransportCapacity(transports: TransportCapacityRow[]): number {
  return transports.reduce((sum, t) => {
    const cap = BALANCE.colonyTransport.capacityPerTier[t.tier] ?? 0;
    return sum + cap;
  }, 0);
}

/**
 * Capacity contributed by a single transport at the given tier.
 */
export function tierCapacity(tier: number): number {
  return BALANCE.colonyTransport.capacityPerTier[tier] ?? 0;
}

/**
 * Summary string for display: "2 transports (T1+T2 · 300/period)"
 */
export function transportSummary(transports: TransportCapacityRow[]): string {
  if (transports.length === 0) return "No transports";
  const total = colonyTransportCapacity(transports);
  const tiers = transports.map((t) => `T${t.tier}`).join("+");
  return `${transports.length} transport${transports.length !== 1 ? "s" : ""} (${tiers} · ${total}/period)`;
}

/**
 * Short summary for map overlay: "T1+T2 · 300/period"
 */
export function transportShortSummary(transports: TransportCapacityRow[]): string {
  if (transports.length === 0) return "No transport";
  const total = colonyTransportCapacity(transports);
  const tiers = transports.map((t) => `T${t.tier}`).join("+");
  return `${tiers} · ${total}/period`;
}

/**
 * Upgrade cost for upgrading a transport to the given target tier.
 * Returns null if tier is out of range or is tier 1 (purchase flow instead).
 */
export function transportUpgradeCost(
  targetTier: number,
): { iron: number; carbon: number; steel: number } | null {
  if (targetTier < 2 || targetTier > 5) return null;
  return BALANCE.colonyTransport.upgradeCosts[targetTier] ?? null;
}
