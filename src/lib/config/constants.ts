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

/** Starter ship stats for newly registered players */
export const STARTER_SHIP = {
  name: "Pioneer",
  speedLyPerHr: 1.0,
  cargoCap: 100,
} as const;
