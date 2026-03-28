/**
 * Ship automation helpers — Phase 8.
 *
 * Pure functions only (no DB access). The lazy-resolution loop lives in the
 * dashboard page component, similar to colony growth resolution.
 *
 * Automation cycle:
 *   idle → traveling_to_colony → (arrive) → load → traveling_to_station
 *        → (arrive) → unload → idle → …
 *
 * Loading and unloading are resolved instantaneously on page load.
 * Travel is time-gated (arrive_at timestamp in travel_jobs).
 */

import { getCatalogEntry } from "@/lib/catalog";
import { distanceBetween } from "@/lib/game/travel";
import { BALANCE } from "@/lib/config/balance";
import type { Ship } from "@/lib/types/game";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutoState = "idle" | "traveling_to_colony" | "traveling_to_station";

export interface AutoColonyCandidate {
  colonyId: string;
  systemId: string;
  totalInventory: number;
  /** 0 when the colony is in the same system as the ship. */
  distanceLy: number;
}

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

/**
 * Rank player colonies as candidates for an auto ship to collect from.
 *
 * Criteria:
 *   - Colony must have accumulated inventory (totalInventory > 0).
 *   - Colony must be reachable within BALANCE.lanes.baseRangeLy of the
 *     ship's current system, OR be in the same system (distance = 0).
 *
 * Sort order:
 *   auto_collect_nearest  → ascending distanceLy (ties broken by totalInventory desc)
 *   auto_collect_highest  → descending totalInventory (ties broken by distanceLy asc)
 *
 * Returns [] when the ship has no current_system_id (in transit) or when no
 * reachable colony with inventory exists.
 */
export function rankColonyCandidates(
  ship: Pick<Ship, "current_system_id" | "cargo_cap">,
  colonies: { id: string; system_id: string }[],
  colonyInvTotals: Map<string, number>,
  mode: "auto_collect_nearest" | "auto_collect_highest",
  /** If set, this colony is sorted to the top of the list (player assignment). */
  pinnedColonyId?: string | null,
): AutoColonyCandidate[] {
  if (!ship.current_system_id) return [];

  const fromEntry = getCatalogEntry(ship.current_system_id);
  if (!fromEntry) return [];

  const maxRange = BALANCE.lanes.baseRangeLy;
  const candidates: AutoColonyCandidate[] = [];

  for (const colony of colonies) {
    const total = colonyInvTotals.get(colony.id) ?? 0;
    if (total === 0) continue;

    let distanceLy: number;
    if (colony.system_id === ship.current_system_id) {
      distanceLy = 0;
    } else {
      const toEntry = getCatalogEntry(colony.system_id);
      if (!toEntry) continue;
      distanceLy = distanceBetween(
        { x: fromEntry.x, y: fromEntry.y, z: fromEntry.z },
        { x: toEntry.x, y: toEntry.y, z: toEntry.z },
      );
      if (distanceLy > maxRange) continue;
    }

    candidates.push({ colonyId: colony.id, systemId: colony.system_id, totalInventory: total, distanceLy });
  }

  // Sort by mode, then promote pinned colony to top if it is a valid candidate
  const sorted = mode === "auto_collect_nearest"
    ? candidates.sort((a, b) => a.distanceLy - b.distanceLy || b.totalInventory - a.totalInventory)
    : candidates.sort((a, b) => b.totalInventory - a.totalInventory || a.distanceLy - b.distanceLy);

  if (pinnedColonyId) {
    const pinnedIdx = sorted.findIndex((c) => c.colonyId === pinnedColonyId);
    if (pinnedIdx > 0) {
      // Move pinned colony to position 0 without mutating the rest of the order
      const [pinned] = sorted.splice(pinnedIdx, 1);
      sorted.unshift(pinned);
    }
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Human-readable label for a ship's automation step, shown in the ShipRow.
 *
 * @param state       current auto_state value
 * @param targetName  pre-resolved display name for the target system (optional)
 */
export function autoStateLabel(
  state: AutoState | null | undefined,
  targetName?: string,
): string {
  switch (state) {
    case "traveling_to_colony":
      return targetName ? `Collecting → ${targetName}` : "En route to colony";
    case "traveling_to_station":
      return targetName ? `Returning → ${targetName}` : "Returning to station";
    case "idle":
    default:
      return "Idle";
  }
}

/**
 * Formats a millisecond duration as a human-readable ETA string.
 * Used by server-rendered pages to show time remaining for ships in transit.
 *
 * Examples: "< 1 min", "34 min", "2h 15m", "7h"
 */
export function formatEtaMs(remainingMs: number): string {
  if (remainingMs <= 0) return "arriving";
  const totalMin = Math.ceil(remainingMs / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** Human-readable label for a ShipDispatchMode value. */
export function dispatchModeLabel(mode: string): string {
  switch (mode) {
    case "manual":
      return "Manual";
    case "auto_collect_nearest":
      return "Auto: Nearest";
    case "auto_collect_highest":
      return "Auto: Highest yield";
    default:
      return mode;
  }
}
