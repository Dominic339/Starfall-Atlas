/**
 * Persisted game entity types — match rows returned from Supabase.
 * Every interface corresponds to a table defined in the migrations.
 */

import type {
  JobStatus,
  LaneAccess,
  AllianceRole,
  StructureType,
  ColonyStatus,
  GateStatus,
  OrderSide,
  OrderStatus,
  AuctionStatus,
  AuctionItemType,
  WorldEventType,
  PremiumItemType,
  InventoryLocationType,
  StewardshipMethod,
  ShipDispatchMode,
} from "./enums";

// ---------------------------------------------------------------------------
// Branded ID types for compile-time safety
// ---------------------------------------------------------------------------

export type PlayerId = string & { readonly _brand: "PlayerId" };
export type ShipId = string & { readonly _brand: "ShipId" };
export type StationId = string & { readonly _brand: "StationId" };
export type ColonyId = string & { readonly _brand: "ColonyId" };
export type LaneId = string & { readonly _brand: "LaneId" };
export type GateId = string & { readonly _brand: "GateId" };
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
  /** NULL = stipend never granted. Used for Sol safety stipend lazy check. */
  sol_stipend_last_at: string | null;
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
  /**
   * How this ship is assigned work.
   * 'manual' = explicit player dispatch (default).
   * Auto modes loop: find colony → travel → load → return → unload → repeat.
   */
  dispatch_mode: ShipDispatchMode;
  /**
   * Current step in the automation cycle. NULL when dispatch_mode is 'manual'.
   * 'idle'                = waiting for a target colony.
   * 'traveling_to_colony' = en route to collect from auto_target_colony.
   * 'traveling_to_station'= returning to station to unload cargo.
   */
  auto_state: "idle" | "traveling_to_colony" | "traveling_to_station" | null;
  /** The colony being targeted in the current automation cycle. NULL when idle or manual. */
  auto_target_colony_id: ColonyId | null;
  skin_entitlement_id: string | null;
  /** Per-stat upgrade levels (0–10). Research controls soft caps. */
  hull_level: number;
  shield_level: number;
  cargo_level: number;
  engine_level: number;
  turret_level: number;
  utility_level: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Core player station
// ---------------------------------------------------------------------------

/**
 * Every player has exactly one core station — their central hub.
 * Created automatically at Sol during player bootstrap.
 * Resources flow: colonies (extraction) → ships (transport) → station (hub).
 *
 * Station inventory is stored in resource_inventory with location_type='station'.
 */
export interface PlayerStation {
  id: StationId;
  owner_id: PlayerId;
  name: string;
  /** Current system. NULL while in transit (station movement is future). */
  current_system_id: SystemId;
  skin_entitlement_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// World state: discoveries and surveys
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
// Colonies and structures
// ---------------------------------------------------------------------------

export interface Colony {
  id: ColonyId;
  owner_id: PlayerId;
  system_id: SystemId;
  body_id: BodyId;
  status: ColonyStatus;
  population_tier: number;
  next_growth_at: string | null;
  last_tax_collected_at: string;
  storage_cap: number;
  /**
   * Timestamp of last resource extraction into station inventory.
   * Initialized to created_at on colony founding. NULL only for rows
   * created before migration 00017 (back-filled by migration).
   */
  last_extract_at: string | null;
  /** Set when status transitions to 'abandoned' */
  abandoned_at: string | null;
  /** Set when status transitions to 'collapsed' */
  collapsed_at: string | null;
  /**
   * Timestamp of the last period iron upkeep was fully paid.
   * NULL only for very old rows before migration 00019 (back-filled by migration).
   */
  last_upkeep_at: string | null;
  /**
   * Consecutive upkeep periods that were not fully supplied.
   * 0 = well-supplied. ≥1 = struggling. ≥3 = neglected.
   * Every BALANCE.upkeep.tierLossMissedPeriods consecutive misses → tier loss.
   */
  upkeep_missed_periods: number;
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
// System governance
// ---------------------------------------------------------------------------

/**
 * System stewardship — records first-discoverer governance rights.
 * Replaces the former `SystemOwnership` interface.
 * Discovery credit is separate (SystemDiscovery.is_first).
 */
export interface SystemStewardship {
  id: string;
  system_id: SystemId;
  steward_id: PlayerId;
  method: StewardshipMethod;
  /** TRUE when the steward is the active governance holder (no majority controller). */
  has_governance: boolean;
  /** Royalty rate effective only when has_governance = true */
  royalty_rate: number;
  acquired_at: string;
  updated_at: string;
}

/**
 * System majority control — set when a player or alliance crosses the influence threshold.
 * When this exists and is_confirmed=true, the majority controller holds governance,
 * not the steward.
 */
export interface SystemMajorityControl {
  id: string;
  system_id: SystemId;
  controller_id: PlayerId;
  /** Non-null when the majority is held collectively by an alliance. */
  alliance_id: AllianceId | null;
  /** Influence share (0.5–1.0) at the time control was last confirmed. */
  influence_share: number;
  /** FALSE when controller has fallen below threshold (contested state). */
  is_confirmed: boolean;
  control_since: string;
  updated_at: string;
}

/**
 * Denormalized cache of per-player influence in a system.
 * Recomputed on colony tier changes, structure changes, and gate events.
 */
export interface SystemInfluenceCache {
  id: string;
  system_id: SystemId;
  player_id: PlayerId;
  influence: number;
  colony_count: number;
  computed_at: string;
}

// ---------------------------------------------------------------------------
// Hyperspace gates (system-level infrastructure)
// ---------------------------------------------------------------------------

export interface HyperspaceGate {
  id: GateId;
  system_id: SystemId;
  owner_id: PlayerId;
  status: GateStatus;
  tier: number;
  built_at: string | null;
  neutralized_at: string | null;
  reclaimed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GateConstructionJob {
  id: string;
  gate_id: GateId;
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
  /** Gate at the source endpoint. Null for premium Stabilized Wormhole (far end). */
  from_gate_id: GateId | null;
  /** Gate at the destination endpoint. */
  to_gate_id: GateId | null;
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
  /** Non-null when the job was created by a fleet dispatch. */
  fleet_id: string | null;
  depart_at: string;
  arrive_at: string;
  transit_tax_paid: number;
  status: JobStatus;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Fleets
// ---------------------------------------------------------------------------

export type FleetStatus = "active" | "traveling" | "disbanded";

/** Fleet header row — a named, temporary grouping of co-located ships. */
export interface Fleet {
  id: string;
  player_id: PlayerId;
  name: string;
  /** 'active' = staged at current_system_id. 'traveling' = ships in transit. 'disbanded' = dissolved. */
  status: FleetStatus;
  /** System where ships are staged. NULL while traveling. */
  current_system_id: SystemId | null;
  disbanded_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Join row linking a ship to its current fleet. */
export interface FleetShip {
  fleet_id: string;
  ship_id: ShipId;
  joined_at: string;
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
// Economy: markets and auctions
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

export interface UniversalExchangePurchase {
  id: string;
  player_id: PlayerId;
  resource_type: string;
  quantity: number;
  credits_paid: number;
  colony_id: ColonyId;
  purchased_at: string;
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
// Research
// ---------------------------------------------------------------------------

/**
 * A single research entry that a player has unlocked.
 * Definitions live in src/lib/config/research.ts.
 */
export interface PlayerResearch {
  id: string;
  player_id: PlayerId;
  /** Matches a ResearchDefinition.id from research.ts */
  research_id: string;
  unlocked_at: string;
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

// ---------------------------------------------------------------------------
// Computed / derived types (not direct DB rows)
// ---------------------------------------------------------------------------

/**
 * Resolved governance state for a system — combines stewardship and majority control
 * into a single view for server-side logic.
 */
export interface SystemGovernance {
  systemId: SystemId;
  /** Player credited with first discovery (permanent). */
  firstDiscovererId: PlayerId;
  /** Current steward (may differ from first discoverer after transfer). */
  stewardId: PlayerId;
  /** TRUE when steward holds governance (no active majority controller). */
  stewardHasGovernance: boolean;
  /** Player/alliance holding majority control, or null if none. */
  majorityController: {
    playerId: PlayerId;
    allianceId: AllianceId | null;
    influenceShare: number;
    isConfirmed: boolean;
  } | null;
  /** Who currently holds governance: 'steward' | 'majority' | 'ungoverned' */
  governanceHolder: "steward" | "majority" | "ungoverned";
  /** Active royalty rate from the current governance holder. */
  royaltyRate: number;
}
