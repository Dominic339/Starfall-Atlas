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
    /**
     * Base ship speed in light-years per hour.
     * Phase 28: increased for ~30 min travel at medium distances (~5 ly).
     * A 5 ly journey at 10 ly/hr = 30 minutes.
     */
    baseSpeedLyPerHr: 10.0,
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
     * Iron cost to found a colony, by planet body type.
     * First colony is always free (tutorial onboarding).
     * Subsequent colonies cost iron based on planet habitability.
     *
     * Tiers:
     *   Lush   (300): lush, habitable — richest biospheres, easiest to settle
     *   Ocean  (400): ocean, rocky, desert — moderate conditions
     *   Harsh  (600): volcanic, toxic — requires dome research (GAME_RULES.md §16)
     *   Extreme (900): barren, frozen, ice_planet — barely habitable environments
     *
     * Any unlisted type falls back to foundingCostIronDefault.
     */
    foundingCostIronByType: {
      lush:       300,
      habitable:  300,
      ocean:      400,
      rocky:      400,
      desert:     400,
      volcanic:   600,
      toxic:      600,
      barren:     900,
      frozen:     900,
      ice_planet: 900,
    } as Record<string, number>,

    /** Fallback founding cost for any body type not in foundingCostIronByType. */
    foundingCostIronDefault: 400,

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

    /**
     * Colony slot (colony_slots) progression.
     *
     * players.colony_slots controls how many active colonies a player may own.
     * The DB default is 20. Higher tiers are unlocked via gameplay milestones.
     *
     *   20   — base (default for all new and existing players)
     *   30   — Upgrade 1 (future milestone)
     *   40   — Upgrade 2 (future milestone)
     *   9999 — Unlimited tier (sentinel — effectively uncapped)
     *
     * The sentinel value (9999) is used as a DB integer; UI code should
     * display "Unlimited" whenever colony_slots >= colonySlotsUnlimited.
     */
    slotsDefault: 20,
    slotsUpgrade1: 30,
    slotsUpgrade2: 40,
    slotsUnlimited: 9999,
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

    /** Maximum number of active lanes a single player may own. */
    maxOwnedLanes: 20,

    /** Hours a warp tunnel lane remains active before expiring. */
    warpTunnelExpiryHours: 48,
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

    /** Minimum auction duration in hours */
    minDurationHours: 1,

    /** Maximum auction duration in days */
    maxDurationDays: 7,

    /** Default auction duration in hours shown in the create form */
    defaultDurationHours: 24,
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
     * Phase 28: 1 unit/5s = 720 u/hr base rate (at tier 1, per node).
     * At tier 2: 1440 u/hr per node.
     */
    baseUnitsPerHrPerTier: 720,

    /**
     * Maximum hours of extraction yield that can accumulate before
     * the timer is considered saturated. Prevents idle overflow.
     */
    accumulationCapHours: 12,
  },

  // -------------------------------------------------------------------------
  // Colony upkeep (GAME_RULES.md §7.2 — Phase 16 food + iron dome model)
  //
  // All colonies consume food each period (population sustain resource).
  // Harsh colonies (volcanic, toxic) additionally consume iron for dome
  // maintenance. Health is determined by whether both required resources
  // were available.
  // -------------------------------------------------------------------------
  upkeep: {
    /** Hours between upkeep resolution periods. */
    periodHours: 24,

    /**
     * Food units consumed per tier per period (ALL colonies).
     * A tier-3 colony needs 6 food per 24-hour period.
     * Food is produced by refining biomass+water at the station.
     */
    foodPerTierPerPeriod: 2,

    /**
     * Iron units consumed per tier per period for harsh colonies ONLY
     * (volcanic and toxic planet types — dome/maintenance upkeep).
     * Non-harsh colonies do not consume iron for upkeep.
     */
    ironPerTierPerPeriod: 2,

    /**
     * Maximum number of overdue periods resolved in a single page load.
     * Caps resource draw per session and prevents runaway catch-up loops.
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
      null,                       // 0: unused
      { iron: 30, carbon: 0 },   // 1: initial build
      { iron: 75, carbon: 0 },   // 2: upgrade to tier 2
      { iron: 150, carbon: 0 },  // 3: upgrade to tier 3
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
     * Base iron cost for ship stat upgrades.
     * Phase 28: exponential formula — cost to reach level N = Math.ceil(base * 1.8^N).
     * Computed in shipUpgrades.ts upgradeIronCost().
     *
     * Sample costs (hull base=300):
     *   → level 2: ceil(300 × 1.8²) = 972   → level 5: ceil(300 × 1.8⁵) = 5669
     * Sample costs (engine base=500):
     *   → level 2: ceil(500 × 1.8²) = 1620  → level 5: ceil(500 × 1.8⁵) = 9449
     */
    ironCostBase: {
      hull:    300,
      shield:  300,
      cargo:   200,
      engine:  500,
      turret:  350,
      utility: 300,
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
     * Phase 28: must match travel.baseSpeedLyPerHr.
     * Ships default to engine_level=1, giving effectiveSpeed = 11.0 ly/hr.
     */
    baseSpeedLyPerHr: 10.0,

    /** Additional speed (ly/hr) per engine upgrade level. */
    speedPerLevel: 1.0,

    /**
     * Ship tier thresholds — minimum total upgrades (inclusive) to reach each tier.
     * Index = tier (1-based). Index 0 is unused.
     *   Tier 1: 0–3   Tier 2: 4–11  Tier 3: 12–23
     *   Tier 4: 24–59  Tier 5: 60
     */
    tierMinUpgrades: [0, 0, 4, 12, 24, 60] as number[],
  },

  // -------------------------------------------------------------------------
  // Station refining (Phase 15)
  // -------------------------------------------------------------------------
  refining: {
    /**
     * Refining recipes. Key = output resource type.
     * Each recipe defines how many input units are consumed per output unit.
     * All conversions are 1:1 per unit of output.
     */
    recipes: {
      steel: {
        inputs: [
          { resource_type: "iron",   quantity: 1 },
          { resource_type: "carbon", quantity: 1 },
        ],
        outputPerBatch: 1,
      },
      glass: {
        inputs: [
          { resource_type: "silica", quantity: 1 },
        ],
        outputPerBatch: 1,
      },
      food: {
        inputs: [
          { resource_type: "biomass", quantity: 1 },
          { resource_type: "water",   quantity: 1 },
        ],
        outputPerBatch: 1,
      },
    } as Record<string, { inputs: { resource_type: string; quantity: number }[]; outputPerBatch: number }>,
  },

  // -------------------------------------------------------------------------
  // Colony transports (Phase 15 / Phase 18)
  // -------------------------------------------------------------------------
  colonyTransport: {
    /**
     * Speed of colony transport units in light-years per hour.
     * Used to compute minimum route intervals.
     */
    speedLyPerHr: 2.0,

    /** Minimum route interval regardless of distance. */
    minIntervalMinutes: 30,

    /** Maximum periods to resolve per dashboard load (prevents runaway catch-up). */
    maxCatchupPeriods: 24,

    /**
     * Threshold for 'excess' mode: resources above this quantity are transferred.
     * e.g. if colony has 150 iron and threshold = 100, transfer 50.
     */
    excessThreshold: 100,

    // ── Phase 18: transport purchasing and throughput ───────────────────────

    /**
     * Iron cost to purchase a new tier-1 colony transport unit.
     * Deducted from player station inventory.
     */
    purchaseCostIron: 20,

    /**
     * Cost to upgrade a transport from tier (N-1) to tier N.
     * Index = target tier (1-based; index 0 unused).
     * All costs deducted from station inventory.
     */
    upgradeCosts: [
      null,                                      // [0] unused
      null,                                      // [1] purchase (use purchaseCostIron)
      { iron: 40,  carbon: 10, steel: 0  },      // [2] T1 → T2
      { iron: 80,  carbon: 20, steel: 0  },      // [3] T2 → T3
      { iron: 150, carbon: 40, steel: 20 },      // [4] T3 → T4
      { iron: 250, carbon: 80, steel: 50 },      // [5] T4 → T5
    ] as (null | { iron: number; carbon: number; steel: number })[],

    /**
     * Maximum resources a single transport can carry per route resolution period.
     * Index = tier (1-based). Index 0 unused.
     * Total colony capacity = sum of capacityPerTier[tier] for each transport row.
     */
    capacityPerTier: [0, 100, 200, 350, 500, 750] as number[],
  },

  // -------------------------------------------------------------------------
  // Asteroid events and shared harvest nodes (Phase 20)
  // -------------------------------------------------------------------------
  asteroids: {
    /**
     * Base units harvested per hour when the fleet has 0 turret levels.
     * Ensures every fleet contributes something even before upgrades.
     */
    baseHarvestUnitsPerHr: 2,

    /**
     * Additional units per hour per point of total turret_level across
     * all ships in the dispatched fleet.
     * Example: a fleet with 3 ships each at turret_level 2 = 6 total → 30 u/hr bonus.
     */
    harvestUnitsPerHrPerTurretLevel: 5,

    /**
     * Maximum hours of harvest accumulation that can be resolved in a single
     * page-load pass. Prevents enormous single-session catch-up yields.
     */
    maxHarvestAccumulationHours: 24,

    /**
     * Starting total_amount (units) seeded per resource type.
     * Also used for any future asteroid spawning logic.
     */
    initialAmountByResource: {
      iron:         500,
      carbon:       400,
      silica:       350,
      sulfur:       300,
      rare_crystal: 150,
    } as Record<string, number>,
  },

  // -------------------------------------------------------------------------
  // Alliances and beacons (Phase 23)
  // -------------------------------------------------------------------------
  alliance: {
    /**
     * Iron cost (deducted from station inventory) to found a new alliance.
     * Represents a meaningful commitment while remaining achievable early-game.
     */
    createCostIron: 100,

    /**
     * Iron cost (deducted from station inventory) to place a single beacon
     * on a catalog system. Officer or founder only.
     */
    beaconPlaceCostIron: 50,

    /**
     * Maximum 2D catalog-space distance (light-years, ignoring z) for two
     * beacons to be considered "linked".  Also the maximum allowed length of
     * any convex-hull edge — hull edges longer than this invalidate the
     * territory polygon even if the hull has ≥ 3 vertices.
     *
     * At 10 ly the following alpha-catalog triangles are achievable:
     *   Sol + Wolf 359 + Lalande 21185  (edges ≈ 7.72, 6.73, 1.02 ly)
     *   Sol + Barnard's Star + Ross 154 (edges ≈ 5.95, 8.85, 3.32 ly)
     */
    beaconLinkMaxDistanceLy: 10,

    /**
     * Maximum number of simultaneously active beacons an alliance may hold.
     * Prevents beacon spam; intended as a soft territory cap for alpha.
     */
    maxActiveBeacons: 20,
  },

  // -------------------------------------------------------------------------
  // Beacon disputes (Phase 25)
  // -------------------------------------------------------------------------
  disputes: {
    /**
     * Duration of the dispute window in hours.
     * After this window expires, the side with the highest score wins.
     */
    windowHours: 8,

    /**
     * Cooldown applied to a disputed beacon (and nearby linked beacons) after
     * a dispute resolves. During cooldown, the beacon cannot be challenged again.
     */
    cooldownHours: 48,

    /**
     * Maximum number of beacon-link hops from the disputed beacon to include
     * in the post-resolution cooldown sweep.
     * 1 = direct neighbors only.
     */
    cooldownNeighborhoodLinks: 1,

    /**
     * Score weights applied per ship when computing a fleet's dispute score.
     * All weights must be non-negative integers.
     * Score per ship = turret_level × turretWeight + hull_level × hullWeight + shield_level × shieldWeight.
     */
    scoreWeights: {
      turret: 3,
      hull:   1,
      shield: 1,
    },
  },

  // -------------------------------------------------------------------------
  // Core player station (GAME_RULES.md §21)
  // -------------------------------------------------------------------------
  station: {
    /**
     * Station movement speed — INTENTIONALLY DISABLED (Phase 30).
     *
     * Station movement has never been implemented. The DB column
     * `player_stations.current_system_id` is non-nullable; stations are always
     * fixed at their founding location. There is no station travel_jobs table,
     * no movement UI, and no movement API route.
     *
     * This config value is retained as a placeholder for when station movement
     * is eventually built out, but it has zero effect on current gameplay.
     * Do NOT add UI that implies stations can move until the full movement
     * system (station travel_jobs, state machine, resolve route) is implemented.
     */
    baseSpeedLyPerHr: 0.1,
  },
} as const;

// Derived types for callers who want to type-check against balance values
export type BalanceConfig = typeof BALANCE;
