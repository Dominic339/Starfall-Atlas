/**
 * Game enums — mirror the Postgres enum types defined in the migrations.
 * These are string union types (not TypeScript enums) for compatibility with Supabase.
 */

export type JobStatus = "pending" | "complete" | "cancelled" | "failed";

export type LaneAccess = "public" | "alliance_only" | "private";

export type AllianceRole = "founder" | "officer" | "member";

/** Colony-level structure types. Hyperspace gates are a separate system-level entity. */
export type StructureType =
  | "extractor"
  | "warehouse"
  | "shipyard" // post-alpha only
  | "trade_hub"
  | "relay_station";

/** Colony lifecycle state (see GAME_RULES.md §20). */
export type ColonyStatus =
  | "active"    // operating normally
  | "abandoned" // owner inactive; no production/influence; within resolution window
  | "collapsed"; // resolution window expired; body is claimable again

/** Hyperspace gate operational state (see GAME_RULES.md §8.2). */
export type GateStatus =
  | "inactive" // under construction
  | "active"   // operational; governance holder controls access policy
  | "neutral"; // governance changed; public access; no active owner managing it

export type OrderSide = "sell" | "buy";

export type OrderStatus =
  | "open"
  | "filled"
  | "partially_filled"
  | "expired"
  | "cancelled";

export type AuctionStatus = "active" | "resolved" | "cancelled";

export type WorldEventType =
  | "system_discovered"
  | "stewardship_registered"   // first discoverer becomes steward
  | "stewardship_transferred"  // stewardship sold or voluntarily transferred
  | "majority_control_gained"  // player/alliance crosses influence threshold
  | "majority_control_lost"    // majority controller falls below threshold
  | "colony_founded"
  | "colony_abandoned"         // player went inactive; colony enters abandoned state
  | "colony_collapsed"         // resolution window expired; body is claimable
  | "colony_reactivated"       // player returned during resolution window
  | "colony_sold"
  | "system_sold"              // stewardship auctioned/transferred
  | "gate_built"
  | "gate_neutralized"         // gate control reset on governance transfer
  | "gate_reclaimed"           // new governance holder reactivated a neutral gate
  | "lane_built"
  | "alliance_formed"
  | "alliance_dissolved";

export type PremiumItemType =
  | "ship_skin"
  | "colony_banner"
  | "vanity_name_tag"
  | "alliance_emblem"
  | "discoverer_monument"
  | "unstable_warp_tunnel"
  | "stabilized_wormhole"
  | "deep_survey_kit"
  | "colony_permit";

/** Resource type codes used in inventory, market, and extraction. */
export type ResourceType =
  // Common (available via Emergency Universal Exchange)
  | "iron"
  | "carbon"
  | "ice"
  // Refined (crafted from common resources; not on EUX)
  | "steel"
  | "fuel_cells"
  | "polymers"
  // Rare (deep survey only; not on EUX)
  | "exotic_matter"
  | "crystalline_core"
  | "void_dust";

/** Common resources available through the Emergency Universal Exchange (GAME_RULES.md §19). */
export const EUX_RESOURCE_TYPES: ReadonlyArray<ResourceType> = [
  "iron",
  "carbon",
  "ice",
] as const;
export type EuxResourceType = (typeof EUX_RESOURCE_TYPES)[number];

/** Star spectral classifications (used in world generation). */
export type SpectralClass = "O" | "B" | "A" | "F" | "G" | "K" | "M";

/** Body types produced by deterministic world generation. */
export type BodyType =
  | "rocky"
  | "habitable"
  | "gas_giant"
  | "ice_giant"
  | "asteroid_belt"
  | "barren"
  | "frozen";

/**
 * Auction item categories.
 * 'stewardship' replaces the old 'system' value — the auction transfers governance rights
 * only, not the permanent discovery credit recorded in system_discoveries.is_first.
 */
export type AuctionItemType = "colony" | "stewardship" | "ship" | "item";

/** Resource inventory location discriminator. */
export type InventoryLocationType =
  | "colony"
  | "ship"
  | "alliance_storage"
  /** Player core station inventory (GAME_RULES.md §21). */
  | "station";

/** How stewardship was most recently acquired. */
export type StewardshipMethod = "discovery" | "transfer" | "auction";

/**
 * Ship dispatch mode — controls how a ship is assigned tasks.
 *
 * 'manual'                = player submits all travel and cargo actions explicitly.
 * 'auto_collect_nearest'  = ship automatically dispatches to collect from the
 *                           nearest colony that has accumulated resources (future).
 * 'auto_collect_highest'  = ship automatically dispatches to the colony with the
 *                           largest accumulated resource quantity (future).
 *
 * Auto modes are scaffolded in the schema and type system; full automation
 * behavior is a post-alpha feature and is not yet implemented server-side.
 * All ships default to 'manual'.
 */
export type ShipDispatchMode =
  | "manual"
  | "auto_collect_nearest"
  | "auto_collect_highest";
