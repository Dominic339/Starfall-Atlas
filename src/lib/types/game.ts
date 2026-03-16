/**
 * Persisted game entity types — match rows returned from Supabase.
 * Every interface corresponds to a table defined in the migrations.
 */

import type {
  JobStatus,
  LaneAccess,
  AllianceRole,
  StructureType,
  OrderSide,
  OrderStatus,
  AuctionStatus,
  AuctionItemType,
  WorldEventType,
  PremiumItemType,
  InventoryLocationType,
} from "./enums";

// ---------------------------------------------------------------------------
// Branded ID types for compile-time safety
// ---------------------------------------------------------------------------

/** Opaque UUID string for a player row */
export type PlayerId = string & { readonly _brand: "PlayerId" };
/** Opaque UUID string for a ship row */
export type ShipId = string & { readonly _brand: "ShipId" };
/** Opaque UUID string for a colony row */
export type ColonyId = string & { readonly _brand: "ColonyId" };
/** Opaque UUID string for a hyperspace lane row */
export type LaneId = string & { readonly _brand: "LaneId" };
/** Opaque UUID string for an alliance row */
export type AllianceId = string & { readonly _brand: "AllianceId" };
/** Catalog-derived system identifier (e.g. HYG id as string) */
export type SystemId = string & { readonly _brand: "SystemId" };
/** Catalog-derived body identifier: "{system_id}:{body_index}" */
export type BodyId = string & { readonly _brand: "BodyId" };

// ---------------------------------------------------------------------------
// Players and ships
// ---------------------------------------------------------------------------

export interface Player {
  id: PlayerId;
  auth_id: string;
  handle: string;
  credits: number;
  colony_slots: number;
  colony_permits_used: number;
  first_colony_placed: boolean;
  last_active_at: string;
  created_at: string;
  updated_at: string;
}

export interface Ship {
  id: ShipId;
  owner_id: PlayerId;
  name: string;
  speed_ly_per_hr: number;
  cargo_cap: number;
  current_system_id: SystemId | null;
  current_body_id: BodyId | null;
  skin_entitlement_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

export interface SystemDiscovery {
  id: string;
  system_id: SystemId;
  player_id: PlayerId;
  is_first: boolean;
  discovered_at: string;
}

export interface SurveyJob {
  id: string;
  player_id: PlayerId;
  ship_id: ShipId;
  system_id: SystemId;
  body_id: BodyId;
  is_deep: boolean;
  started_at: string;
  complete_at: string;
  status: JobStatus;
  created_at: string;
}

export interface ResourceNodeRecord {
  type: string;
  quantity: number;
  is_rare: boolean;
}

export interface SurveyResult {
  id: string;
  system_id: SystemId;
  body_id: BodyId;
  revealed_by: PlayerId;
  resource_nodes: ResourceNodeRecord[];
  has_deep_nodes: boolean;
  deep_nodes: ResourceNodeRecord[];
  first_surveyed_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Colonies
// ---------------------------------------------------------------------------

export interface SystemOwnership {
  id: string;
  system_id: SystemId;
  owner_id: PlayerId;
  royalty_rate: number;
  acquired_at: string;
  updated_at: string;
}

export interface Colony {
  id: ColonyId;
  owner_id: PlayerId;
  system_id: SystemId;
  body_id: BodyId;
  population_tier: number;
  next_growth_at: string | null;
  last_tax_collected_at: string;
  storage_cap: number;
  created_at: string;
  updated_at: string;
}

export interface Structure {
  id: string;
  colony_id: ColonyId;
  owner_id: PlayerId;
  type: StructureType;
  tier: number;
  is_active: boolean;
  built_at: string | null;
  last_extract_at: string | null;
  extract_resource_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConstructionJob {
  id: string;
  structure_id: string;
  player_id: PlayerId;
  started_at: string;
  complete_at: string;
  status: JobStatus;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Hyperspace lanes
// ---------------------------------------------------------------------------

export interface HyperspaceLane {
  id: LaneId;
  owner_id: PlayerId;
  from_system_id: SystemId;
  to_system_id: SystemId;
  access_level: LaneAccess;
  transit_tax_rate: number;
  is_active: boolean;
  built_at: string | null;
  alliance_id: AllianceId | null;
  created_at: string;
  updated_at: string;
}

export interface LaneConstructionJob {
  id: string;
  lane_id: LaneId;
  player_id: PlayerId;
  started_at: string;
  complete_at: string;
  status: JobStatus;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

export interface TravelJob {
  id: string;
  ship_id: ShipId;
  player_id: PlayerId;
  from_system_id: SystemId;
  to_system_id: SystemId;
  lane_id: LaneId | null;
  depart_at: string;
  arrive_at: string;
  transit_tax_paid: number;
  status: JobStatus;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface ResourceInventoryRow {
  id: string;
  location_type: InventoryLocationType;
  location_id: string;
  resource_type: string;
  quantity: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export interface MarketListing {
  id: string;
  region_id: string;
  seller_id: PlayerId | null;
  buyer_id: PlayerId | null;
  side: OrderSide;
  resource_type: string;
  quantity: number;
  quantity_filled: number;
  price_per_unit: number;
  listing_fee_paid: number;
  escrow_held: number;
  system_id: SystemId;
  status: OrderStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface MarketTrade {
  id: string;
  sell_listing_id: string;
  buy_listing_id: string;
  region_id: string;
  resource_type: string;
  quantity: number;
  price_per_unit: number;
  total_credits: number;
  executed_at: string;
}

export interface ClaimTicket {
  id: string;
  trade_id: string;
  buyer_id: PlayerId;
  system_id: SystemId;
  resource_type: string;
  quantity: number;
  claimed: boolean;
  claimed_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface Auction {
  id: string;
  seller_id: PlayerId;
  item_type: AuctionItemType;
  item_id: string;
  min_bid: number;
  current_high_bid: number;
  high_bidder_id: PlayerId | null;
  starts_at: string;
  ends_at: string;
  status: AuctionStatus;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuctionBid {
  id: string;
  auction_id: string;
  bidder_id: PlayerId;
  amount: number;
  escrow_held: boolean;
  placed_at: string;
}

// ---------------------------------------------------------------------------
// Alliances
// ---------------------------------------------------------------------------

export interface Alliance {
  id: AllianceId;
  name: string;
  founder_id: PlayerId;
  member_count: number;
  emblem_entitlement_id: string | null;
  dissolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AllianceMember {
  id: string;
  alliance_id: AllianceId;
  player_id: PlayerId;
  role: AllianceRole;
  alliance_credits: number;
  joined_at: string;
  updated_at: string;
}

export interface AllianceGoal {
  id: string;
  alliance_id: AllianceId;
  created_by: PlayerId;
  title: string;
  resource_type: string;
  quantity_target: number;
  quantity_filled: number;
  credit_reward: number;
  deadline_at: string;
  completed_at: string | null;
  expired: boolean;
  created_at: string;
  updated_at: string;
}

export interface AllianceGoalContribution {
  id: string;
  goal_id: string;
  player_id: PlayerId;
  resource_type: string;
  quantity: number;
  contributed_at: string;
}

// ---------------------------------------------------------------------------
// Premium
// ---------------------------------------------------------------------------

export interface PremiumEntitlement {
  id: string;
  player_id: PlayerId;
  item_type: PremiumItemType;
  item_config: Record<string, unknown>;
  consumed: boolean;
  consumed_at: string | null;
  purchase_ref: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export interface WorldEvent {
  id: string;
  event_type: WorldEventType;
  player_id: PlayerId | null;
  system_id: SystemId | null;
  body_id: BodyId | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}
