/**
 * API request and response types used by the Next.js Route Handlers.
 * All requests are POST with JSON body. All responses are JSON.
 */

import type { Colony, HyperspaceLane, MarketListing } from "./game";

// ---------------------------------------------------------------------------
// Standard result wrapper — used by all action functions and API responses
// ---------------------------------------------------------------------------

export type ApiResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface ApiError {
  code: GameErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type GameErrorCode =
  | "unauthorized"
  | "forbidden"
  | "validation_error"
  | "not_found"
  | "already_exists"
  | "contested" // claim was won by another player
  | "insufficient_credits"
  | "insufficient_resources"
  | "capacity_exceeded"
  | "job_in_progress" // ship already has a pending job
  | "not_yet_complete" // job's complete_at is in the future
  | "colony_limit_reached"
  | "invalid_target" // body is not suitable for the action
  | "lane_out_of_range"
  | "threshold_not_met" // majority threshold not reached
  | "already_auctioned" // item already has an active auction
  | "rate_limited"
  | "internal_error"
  | "not_implemented"; // placeholder for unbuilt features

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

export interface SubmitTravelInput {
  shipId: string;
  toLaneId: string;
}

export interface SubmitTravelResult {
  travelJobId: string;
  arriveAt: string;
  transitTaxPaid: number;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface DiscoverSystemInput {
  shipId: string;
  systemId: string;
}

export interface DiscoverSystemResult {
  isFirst: boolean;
  discoveryId: string;
}

// ---------------------------------------------------------------------------
// Survey
// ---------------------------------------------------------------------------

export interface SubmitSurveyInput {
  shipId: string;
  bodyId: string;
  useDeepSurveyKit: boolean;
}

export interface SubmitSurveyResult {
  surveyJobId: string;
  completeAt: string;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export interface ClaimBodyInput {
  shipId: string;
  bodyId: string;
}

export interface ClaimBodyResult {
  colony: Colony;
}

// ---------------------------------------------------------------------------
// Colony management
// ---------------------------------------------------------------------------

export interface CollectTaxesInput {
  colonyId: string;
}

export interface CollectTaxesResult {
  creditsCollected: number;
  newBalance: number;
}

export interface BuildStructureInput {
  colonyId: string;
  structureType: string;
  extractResourceType?: string;
}

export interface BuildStructureResult {
  structureId: string;
  constructionJobId: string;
  completeAt: string;
}

// ---------------------------------------------------------------------------
// Hyperspace lanes
// ---------------------------------------------------------------------------

export interface BuildLaneInput {
  fromSystemId: string;
  toSystemId: string;
  accessLevel: "public" | "alliance_only" | "private";
  transitTaxRate: number;
  allianceId?: string;
}

export interface BuildLaneResult {
  lane: HyperspaceLane;
  constructionJobId: string;
  completeAt: string;
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export interface PostListingInput {
  regionId: string;
  side: "sell" | "buy";
  resourceType: string;
  quantity: number;
  pricePerUnit: number;
  systemId: string;
  expiryDays?: number;
}

export interface PostListingResult {
  listing: MarketListing;
  listingFeePaid: number;
}

// ---------------------------------------------------------------------------
// Auctions
// ---------------------------------------------------------------------------

export interface CreateAuctionInput {
  itemType: "colony" | "stewardship" | "ship" | "item";
  itemId: string;
  minBid: number;
  startsAt: string;
  endsAt: string;
}

export interface PlaceBidInput {
  auctionId: string;
  amount: number;
}

export interface PlaceBidResult {
  bidId: string;
  newEndTime: string; // may be extended by anti-snipe rule
}

// ---------------------------------------------------------------------------
// Premium items
// ---------------------------------------------------------------------------

export interface ConsumePremiumItemInput {
  entitlementId: string;
  /** Item-specific usage parameters */
  params?: Record<string, unknown>;
}

export interface ConsumePremiumItemResult {
  consumed: boolean;
  appliedEffect: string;
}
