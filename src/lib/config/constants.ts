/**
 * Fixed application constants — not balance values.
 * These are structural/technical constants that do not need tuning.
 */

/** The Sol system ID — every player starts here */
export const SOL_SYSTEM_ID = "sol";

/** The Sol primary body (Earth) ID */
export const SOL_ANCHOR_BODY_ID = "sol:3";

/** Maximum population tier (index into BALANCE.colony arrays) */
export const MAX_COLONY_TIER = 10;

/** Maximum relay station tier */
export const MAX_RELAY_TIER = 5;

/** Maximum structure tier */
export const MAX_STRUCTURE_TIER = 5;

/** Handle minimum/maximum character counts */
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 32;

/** Alliance name min/max */
export const ALLIANCE_NAME_MIN_LENGTH = 3;
export const ALLIANCE_NAME_MAX_LENGTH = 64;

/** Resource quantity type: integer only */
export const MIN_RESOURCE_QUANTITY = 1;

/** Minimum bid increment on auctions */
export const MIN_BID_INCREMENT = 1;

/**
 * Region IDs are stable string identifiers derived from a clustering of
 * the star catalog. For alpha, a single default region is used.
 * TODO(phase-2): Derive real region IDs from catalog clustering.
 */
export const DEFAULT_REGION_ID = "core";

/** How many world_events rows to return per page in the activity feed */
export const WORLD_EVENTS_PAGE_SIZE = 50;

/**
 * Starter ships — every new player begins with two ships at Sol.
 * Ships are the active transport and exploration layer of the economy.
 */
/**
 * Phase 28: ships start at engine_level=1.
 * effectiveSpeed(1) = BALANCE.shipUpgrades.baseSpeedLyPerHr + 1 × speedPerLevel
 *                   = 10.0 + 1 × 1.0 = 11.0 ly/hr.
 *
 * Phase 30: all six stats now start at level 1.
 * effectiveCargoCap(1) = baseCargoCapacity + 1 × cargoCapPerLevel
 *                      = 100 + 1 × 50 = 150 units.
 */
export const STARTER_SHIPS: ReadonlyArray<{
  name: string;
  speedLyPerHr: number;
  cargoCap: number;
}> = [
  { name: "Pioneer I",  speedLyPerHr: 11.0, cargoCap: 150 },
  { name: "Pioneer II", speedLyPerHr: 11.0, cargoCap: 150 },
] as const;

/** @deprecated Use STARTER_SHIPS[0] for the first ship. Kept for backwards compatibility. */
export const STARTER_SHIP = STARTER_SHIPS[0];

/**
 * Default name for the player's core station, created at Sol on first login.
 * Players may be able to rename their station in a future phase.
 */
export const STARTER_STATION_NAME = "Command Station";
