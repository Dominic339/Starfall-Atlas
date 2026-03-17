/**
 * Game balance configuration.
 *
 * ALL numeric game-balance values live here — never hardcode them in
 * action handlers, generation functions, or UI components.
 *
 * To change a rate: change it here. All callers pick up the new value.
 * This file is server-side safe (no browser globals).
 */

export const BALANCE = {
  // -------------------------------------------------------------------------
  // Travel
  // -------------------------------------------------------------------------
  travel: {
    /** Base ship speed in light-years per hour */
    baseSpeedLyPerHr: 1.0,
  },

  // -------------------------------------------------------------------------
  // Colony taxes
  // -------------------------------------------------------------------------
  colony: {
    /**
     * Credits generated per hour by colony at each population tier.
     * Index = tier (1-based). Index 0 is unused.
     * GAME_RULES.md §7: "only source of Credits is colony taxes."
     */
    taxPerHourByTier: [0, 10, 25, 60, 150, 350, 800, 1800, 4000, 9000, 20000],

    /**
     * Hours of tax yield that can accumulate before collection is capped.
     * Prevents runaway idle income (GAME_RULES.md §7).
     */
    taxAccumulationCapHours: 24,

    /**
     * Hours until a colony advances to the next tier.
     * Index = current tier. Index 0 is unused. null = max tier.
     */
    growthHoursByTier: [
      null,  // tier 0 (unused)
      24,    // tier 1 → 2: 1 day
      72,    // tier 2 → 3: 3 days
      168,   // tier 3 → 4: 1 week
      336,   // tier 4 → 5: 2 weeks
      720,   // tier 5 → 6: 30 days
      1440,  // tier 6 → 7: 60 days
      2160,  // tier 7 → 8: 90 days
      4320,  // tier 8 → 9: 180 days
      8760,  // tier 9 → 10: 1 year
      null,  // tier 10: max tier
    ] as (number | null)[],

    /** Default colony storage capacity in resource units */
    defaultStorageCap: 1000,
  },

  // -------------------------------------------------------------------------
  // Hyperspace lanes
  // -------------------------------------------------------------------------
  lanes: {
    /** Base lane construction range in light-years */
    baseRangeLy: 10,

    /** Light-years added per Relay Station tier at either endpoint */
    relayExtensionPerTierLy: 5,

    /** Maximum transit tax percentage a lane owner may set (0–5%) */
    maxTransitTaxPercent: 5,

    /** Hours to build a standard lane (without Stabilized Wormhole) */
    constructionHours: 12,
  },

  // -------------------------------------------------------------------------
  // Claims
  // -------------------------------------------------------------------------
  claims: {
    /** Hours to complete a colony deployment after ship arrives */
    deploymentHours: 4,

    /**
     * Window in seconds within which two competing claims are considered
     * simultaneous. The lower primary-key ID wins ties. (GAME_RULES.md §17)
     */
    tieWindowSeconds: 1,
  },

  // -------------------------------------------------------------------------
  // Surveys
  // -------------------------------------------------------------------------
  surveying: {
    /** Hours to complete a basic survey */
    basicSurveyHours: 6,

    /** Hours to complete a deep survey (premium item) */
    deepSurveyHours: 2,
  },

  // -------------------------------------------------------------------------
  // Market
  // -------------------------------------------------------------------------
  market: {
    /**
     * Listing fee as integer percentage (burned on creation).
     * GAME_RULES.md §9.2
     */
    listingFeePercent: 2,

    /** Default number of days before an unmatched listing expires */
    defaultExpiryDays: 7,
  },

  // -------------------------------------------------------------------------
  // Auctions
  // -------------------------------------------------------------------------
  auctions: {
    /**
     * Minutes before auction end at which a new bid triggers a time extension.
     * GAME_RULES.md §10 (anti-snipe rule)
     */
    antiSnipeWindowMinutes: 5,

    /** Minutes added to the auction timer when anti-snipe triggers */
    antiSnipeExtensionMinutes: 5,
  },

  // -------------------------------------------------------------------------
  // Alliances
  // -------------------------------------------------------------------------
  alliances: {
    /** Maximum number of members per alliance (GAME_RULES.md §11) */
    maxMembers: 100,

    /** Maximum royalty percentage the governance holder may set (GAME_RULES.md §13) */
    royaltyCapPercent: 20,
  },

  // -------------------------------------------------------------------------
  // Premium items
  // -------------------------------------------------------------------------
  premium: {
    /**
     * Maximum number of Colony Permit items per account.
     * Each permit adds +1 colony slot. (GAME_RULES.md §14.2)
     */
    maxColonyPermitsPerAccount: 2,
  },

  // -------------------------------------------------------------------------
  // System influence and majority control (GAME_RULES.md §4.3)
  // -------------------------------------------------------------------------
  influence: {
    /**
     * Influence contributed per active colony per population tier.
     * A tier-3 colony contributes 30 influence (10 × 3).
     */
    colonyPerTierWeight: 10,

    /** Influence per active non-extractor structure. */
    structureWeight: 5,

    /** Influence per active extractor (lower than other structures). */
    extractorWeight: 3,

    /**
     * One-time bonus for owning the system's hyperspace gate.
     * Applied to the gate owner's influence in that system.
     */
    gateOwnerBonus: 50,

    /**
     * Minimum number of bodies with active colonies required for the majority
     * control threshold to become active in a system.
     */
    majorityThresholdMinColonies: 3,

    /**
     * Hours after majority control becomes contested before governance reverts
     * to the steward (if no new majority forms).
     */
    contestedRevertHours: 48,
  },

  // -------------------------------------------------------------------------
  // Hyperspace gates (GAME_RULES.md §8.2)
  // -------------------------------------------------------------------------
  gates: {
    /** Hours to build a new gate from scratch */
    constructionHours: 24,

    /** Hours to reclaim a neutral gate (reduced cost compared to new construction) */
    reclaimHours: 6,
  },

  // -------------------------------------------------------------------------
  // Inactivity and colony collapse (GAME_RULES.md §20)
  // -------------------------------------------------------------------------
  inactivity: {
    /** Days without login before colonies enter abandoned state */
    thresholdDays: 30,

    /**
     * Days in abandoned state before collapse (the resolution window).
     * Player must log in during this period to reactivate colonies.
     */
    resolutionWindowDays: 7,
  },

  // -------------------------------------------------------------------------
  // Emergency Universal Exchange (GAME_RULES.md §19)
  // -------------------------------------------------------------------------
  emergencyExchange: {
    /**
     * Multiplier applied to the floor price for EUX resource rates.
     * Set above 5× to ensure player markets are always preferred.
     */
    markupMultiplier: 5,

    /**
     * Floor price (Credits per unit) for each EUX common resource.
     * EUX price = floorPrice[resource] × markupMultiplier.
     */
    floorPricePerUnit: {
      iron: 4,
      carbon: 5,
      ice: 3,
    } as Record<string, number>,

    /**
     * Maximum total units a single player may purchase per day (across all EUX resources).
     */
    dailyLimitUnits: 500,

    /**
     * Flat transaction fee percentage added on top of the marked-up price (burned).
     * Provides additional credit sink and discourages over-reliance.
     */
    transactionFeePercent: 10,
  },
} as const;

// Derived types for callers who want to type-check against balance values
export type BalanceConfig = typeof BALANCE;
