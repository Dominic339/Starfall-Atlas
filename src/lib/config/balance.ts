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

  // -------------------------------------------------------------------------
  // Sol safety stipend (GAME_RULES.md §22)
  // -------------------------------------------------------------------------
  solStipend: {
    /**
     * Credits granted per 24-hour period when the player qualifies.
     * Intentionally small — this is an anti-softlock floor, not an income source.
     * A single Tier 1 colony produces 10 ¢/hr = 240 ¢/day, dwarfing this amount.
     */
    dailyCredits: 25,

    /**
     * The stipend is only granted when the player's credit balance is at or below
     * this value. Once the player has a real income stream, the stipend never fires.
     */
    creditThreshold: 50,
  },

  // -------------------------------------------------------------------------
  // Resource extraction (GAME_RULES.md §7.1 — colony → station flow)
  // -------------------------------------------------------------------------
  extraction: {
    /**
     * Base resource units produced per hour per population tier,
     * per basic resource node revealed by survey.
     * At tier 1: 5 u/hr per node → 60 units per 12h cap period.
     * At tier 2: 10 u/hr per node → 120 units per cap period.
     */
    baseUnitsPerHrPerTier: 5,

    /**
     * Maximum hours of extraction yield that can accumulate before
     * the timer is considered saturated. Prevents idle overflow.
     */
    accumulationCapHours: 12,
  },

  // -------------------------------------------------------------------------
  // Colony upkeep (GAME_RULES.md §7.2 — iron supply keeps colonies healthy)
  // -------------------------------------------------------------------------
  upkeep: {
    /** Hours between upkeep resolution periods. */
    periodHours: 24,

    /**
     * Iron units consumed per tier per period.
     * A tier-3 colony needs 6 iron per 24-hour period.
     */
    ironPerTierPerPeriod: 2,

    /**
     * Maximum number of overdue periods resolved in a single page load.
     * Caps the iron draw per session and prevents runaway catch-up loops.
     */
    maxCatchupPeriods: 14,

    /**
     * Missed periods at or above which the colony becomes "struggling".
     * Reduces extraction and tax yield.
     */
    strugglingThreshold: 1,

    /**
     * Missed periods at or above which the colony becomes "neglected".
     * Severer yield reduction and growth blocked.
     */
    neglectedThreshold: 3,

    /**
     * Every N consecutive missed periods the colony loses one population tier.
     * Counter resets after each tier loss. Minimum tier is 1.
     */
    tierLossMissedPeriods: 5,
  },

  // -------------------------------------------------------------------------
  // Colony structures and wired research effects (Phase 14)
  // -------------------------------------------------------------------------
  structures: {
    /** Maximum structure tier buildable in alpha. */
    maxTier: 3,

    /**
     * Iron and carbon cost to build or upgrade to each tier.
     * buildCostByTier[1] = build tier 1, buildCostByTier[2] = upgrade to tier 2, etc.
     * Index 0 is unused.
     */
    buildCostByTier: [
      null,                        // 0: unused
      { iron: 20, carbon: 10 },   // 1: initial build
      { iron: 50, carbon: 25 },   // 2: upgrade to tier 2
      { iron: 100, carbon: 50 },  // 3: upgrade to tier 3
    ] as (null | { iron: number; carbon: number })[],

    /** Extractor: additional extraction multiplier per tier (additive). */
    extractor: {
      extractionBonusPerTier: 0.25,
    },

    /** Warehouse: additional colony storage cap per tier. */
    warehouse: {
      storageCapPerTier: 500,
    },

    /** Habitat module: upkeep iron reduction fraction per tier (additive, capped at 1.0). */
    habitat_module: {
      upkeepReductionPerTier: 0.20,
    },

    /**
     * Wired colony research effects (extraction_N, sustainability_N, storage_N).
     * Each unlocked research level adds this much bonus.
     */
    researchEffects: {
      /** Per extraction research level: +bonusPerLevel to the extraction multiplier. */
      extractionBonusPerLevel: 0.10,
      /** Per sustainability research level: fraction of upkeep iron saved. */
      sustainabilityBonusPerLevel: 0.10,
      /** Per storage research level: additional storage cap units. */
      storageCapPerLevel: 200,
    },
  },

  // -------------------------------------------------------------------------
  // Ship upgrades (Phase 11)
  // -------------------------------------------------------------------------
  shipUpgrades: {
    /**
     * Iron cost to upgrade a stat to level N = ironCostPerLevel[stat] * N.
     * (Level 1 costs 1×, level 2 costs 2×, …)
     */
    ironCostPerLevel: {
      hull:    8,
      shield:  8,
      cargo:   10,
      engine:  15,
      turret:  12,
      utility: 8,
    } as Record<string, number>,

    /**
     * Base cargo capacity at level 0.
     * Must match the ships table DEFAULT (00002_players_ships.sql).
     */
    baseCargoCapacity: 100,

    /** Additional cargo_cap units per cargo upgrade level. */
    cargoCapPerLevel: 50,

    /**
     * Base ship speed at level 0 (ly/hr).
     * Must match the ships table DEFAULT (00002_players_ships.sql).
     */
    baseSpeedLyPerHr: 1.0,

    /** Additional speed (ly/hr) per engine upgrade level. */
    speedPerLevel: 0.2,

    /**
     * Ship tier thresholds — minimum total upgrades (inclusive) to reach each tier.
     * Index = tier (1-based). Index 0 is unused.
     *   Tier 1: 0–3   Tier 2: 4–11  Tier 3: 12–23
     *   Tier 4: 24–59  Tier 5: 60
     */
    tierMinUpgrades: [0, 0, 4, 12, 24, 60] as number[],
  },

  // -------------------------------------------------------------------------
  // Core player station (GAME_RULES.md §21)
  // -------------------------------------------------------------------------
  station: {
    /**
     * Station movement speed in light-years per hour.
     * Stations move much more slowly than ships — relocation is a strategic
     * long-horizon decision. Full station movement is a future feature.
     */
    baseSpeedLyPerHr: 0.1,
  },
} as const;

// Derived types for callers who want to type-check against balance values
export type BalanceConfig = typeof BALANCE;
