/**
 * Game enums — mirror the Postgres enum types defined in 00001_enums.sql.
 * These are string union types (not TypeScript enums) for compatibility with Supabase.
 */

export type JobStatus = "pending" | "complete" | "cancelled" | "failed";

export type LaneAccess = "public" | "alliance_only" | "private";

export type AllianceRole = "founder" | "officer" | "member";

export type StructureType =
  | "extractor"
  | "warehouse"
  | "shipyard"
  | "trade_hub"
  | "relay_station";

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
  | "colony_founded"
  | "colony_sold"
  | "system_sold"
  | "alliance_formed"
  | "alliance_dissolved"
  | "lane_built";

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
  // Common
  | "iron"
  | "carbon"
  | "ice"
  // Refined (crafted from common resources)
  | "steel"
  | "fuel_cells"
  | "polymers"
  // Rare
  | "exotic_matter"
  | "crystalline_core"
  | "void_dust";

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

/** Auction item categories. */
export type AuctionItemType = "colony" | "system" | "ship" | "item";

/** Resource inventory location discriminator. */
export type InventoryLocationType = "colony" | "ship" | "alliance_storage";
