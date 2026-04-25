/**
 * Travel duration and route validation utilities.
 *
 * All travel is timestamp-based (GAME_RULES.md §8.1):
 * - depart_at = server timestamp at submission
 * - arrive_at = depart_at + travelDuration(distance, speed)
 *
 * Route validation checks lane existence and access level.
 * Actual transit-tax deduction happens at arrival resolution.
 */

import { BALANCE } from "@/lib/config/balance";
import type { BalanceConfig } from "@/lib/config/balanceOverrides";

// ---------------------------------------------------------------------------
// Duration calculation
// ---------------------------------------------------------------------------

/**
 * Calculate travel duration in milliseconds.
 * @param distanceLy - Distance in light-years
 * @param speedLyPerHr - Ship speed in ly/hr
 * @returns Duration in milliseconds
 */
export function travelDurationMs(
  distanceLy: number,
  speedLyPerHr: number,
): number {
  if (distanceLy <= 0) throw new RangeError("distanceLy must be positive");
  if (speedLyPerHr <= 0) throw new RangeError("speedLyPerHr must be positive");

  const hours = distanceLy / speedLyPerHr;
  return Math.ceil(hours * 60 * 60 * 1000);
}

/**
 * Compute arrive_at timestamp given depart_at and travel duration.
 */
export function computeArrivalTime(
  departAt: Date,
  distanceLy: number,
  speedLyPerHr?: number,
  balance: BalanceConfig = BALANCE,
): Date {
  speedLyPerHr ??= balance.travel.baseSpeedLyPerHr;
  const durationMs = travelDurationMs(distanceLy, speedLyPerHr);
  return new Date(departAt.getTime() + durationMs);
}

// ---------------------------------------------------------------------------
// Transit tax calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the transit tax owed for a journey.
 * The tax is capped at BALANCE.lanes.maxTransitTaxPercent of declared cargo value.
 *
 * @param laneOwnerTaxRate - Integer percentage set by lane owner (0–5)
 * @param declaredCargoValue - Total credit value of cargo being transported
 * @param isPreColony - TRUE if player has not yet placed first colony (tax = 0)
 */
export function calculateTransitTax(
  laneOwnerTaxRate: number,
  declaredCargoValue: number,
  isPreColony: boolean,
  balance: BalanceConfig = BALANCE,
): number {
  if (isPreColony) return 0;
  const cappedRate = Math.min(
    laneOwnerTaxRate,
    balance.lanes.maxTransitTaxPercent,
  );
  return Math.floor((declaredCargoValue * cappedRate) / 100);
}

// ---------------------------------------------------------------------------
// Distance between two 3D positions (ly)
// ---------------------------------------------------------------------------

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

export function distanceBetween(a: Position3D, b: Position3D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

// ---------------------------------------------------------------------------
// Lane range check
// ---------------------------------------------------------------------------

/**
 * Check if a lane can be built between two systems.
 * @param distanceLy - Distance between the two systems
 * @param relayTierA - Relay station tier at system A (0 = no relay)
 * @param relayTierB - Relay station tier at system B (0 = no relay)
 */
export function isWithinLaneRange(
  distanceLy: number,
  relayTierA: number = 0,
  relayTierB: number = 0,
  balance: BalanceConfig = BALANCE,
): boolean {
  const maxRange =
    balance.lanes.baseRangeLy +
    relayTierA * balance.lanes.relayExtensionPerTierLy +
    relayTierB * balance.lanes.relayExtensionPerTierLy;

  return distanceLy <= maxRange;
}
