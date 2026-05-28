/**
 * Hero ship system.
 *
 * Each player has exactly one hero/flagship ship with a class that grants
 * passive bonuses to key game actions. Heroes accumulate XP and level up,
 * improving their bonuses over time.
 *
 * Classes and their passive bonuses:
 *   pathfinder   — +10 ly/hr base travel speed, +2 ly lane range
 *   warlord      — +30% dispute score contribution
 *   merchant     — market listing fee halved (2% → 1%), +15% transit tax collected
 *   industrialist— +25% colony extraction rate
 *   engineer     — -25% construction durations, structure build costs -20%
 *   raider       — +40% asteroid harvest power per turret level
 *
 * XP thresholds per level: XP_FOR_LEVEL[n] = total XP needed to reach level n.
 * Bonuses scale with level: base bonus + (level - 1) × perLevelBonus.
 */

export type HeroClass = "pathfinder" | "warlord" | "merchant" | "industrialist" | "engineer" | "raider";

export const HERO_CLASS_LABELS: Record<HeroClass, string> = {
  pathfinder:    "Pathfinder",
  warlord:       "Warlord",
  merchant:      "Merchant Prince",
  industrialist: "Industrialist",
  engineer:      "Engineer",
  raider:        "Raider",
};

export const HERO_CLASS_DESCRIPTIONS: Record<HeroClass, string> = {
  pathfinder:    "Faster travel and extended lane range. The galaxy's best explorer.",
  warlord:       "Enhanced fleet power in beacon disputes. A force to be feared.",
  merchant:      "Lower market fees and better transit tax income.",
  industrialist: "Boosted resource extraction from every colony node.",
  engineer:      "Faster and cheaper infrastructure construction.",
  raider:        "Amplified asteroid harvesting power for every ship in your fleet.",
};

// Total XP needed to reach level N (1-indexed; level 1 = 0 XP)
export const XP_FOR_LEVEL: number[] = [
  0,    // L1
  100,  // L2
  250,  // L3
  450,  // L4
  700,  // L5
  1000, // L6
  1400, // L7
  1900, // L8
  2500, // L9
  3200, // L10
  4000, // L11
  5000, // L12
  6200, // L13
  7600, // L14
  9200, // L15
  11000,// L16
  13200,// L17
  15700,// L18
  18500,// L19
  21600,// L20
];

export interface HeroBonuses {
  travelSpeedBonusLyHr: number;
  laneRangeBonusLy: number;
  disputeScoreMultiplier: number;  // additive bonus (0.3 = +30%)
  marketFeePercent: number;        // actual fee percent (replaces default)
  transitTaxBonusFraction: number; // additive bonus on transit tax collected
  extractionMultiplierBonus: number; // additive bonus (0.25 = +25%)
  constructionTimeMultiplier: number; // multiplicative (0.75 = -25%)
  structureCostMultiplier: number;    // multiplicative (0.80 = -20%)
  harvestPowerBonusFraction: number;  // additive bonus (0.40 = +40%)
}

const NO_BONUSES: HeroBonuses = {
  travelSpeedBonusLyHr:       0,
  laneRangeBonusLy:           0,
  disputeScoreMultiplier:     0,
  marketFeePercent:           2,   // default 2%
  transitTaxBonusFraction:    0,
  extractionMultiplierBonus:  0,
  constructionTimeMultiplier: 1.0,
  structureCostMultiplier:    1.0,
  harvestPowerBonusFraction:  0,
};

export function heroBonusesForClass(heroClass: HeroClass | null | undefined, level = 1): HeroBonuses {
  if (!heroClass) return NO_BONUSES;
  const lvlBonus = Math.max(0, level - 1); // 0 at L1, 19 at L20
  switch (heroClass) {
    case "pathfinder":
      return {
        ...NO_BONUSES,
        travelSpeedBonusLyHr: 10 + lvlBonus * 1,   // +10 at L1, +29 at L20
        laneRangeBonusLy:     2  + Math.floor(lvlBonus / 4), // +2 at L1, +6 at L17
      };
    case "warlord":
      return {
        ...NO_BONUSES,
        disputeScoreMultiplier: 0.30 + lvlBonus * 0.01, // +30% at L1, +49% at L20
      };
    case "merchant":
      return {
        ...NO_BONUSES,
        marketFeePercent:        Math.max(0, 2 - Math.floor(lvlBonus / 10)), // 2% → 1% at L11
        transitTaxBonusFraction: 0.15 + lvlBonus * 0.005,
      };
    case "industrialist":
      return {
        ...NO_BONUSES,
        extractionMultiplierBonus: 0.25 + lvlBonus * 0.01,
      };
    case "engineer":
      return {
        ...NO_BONUSES,
        constructionTimeMultiplier: Math.max(0.40, 0.75 - lvlBonus * 0.01),
        structureCostMultiplier:    Math.max(0.50, 0.80 - lvlBonus * 0.01),
      };
    case "raider":
      return {
        ...NO_BONUSES,
        harvestPowerBonusFraction: 0.40 + lvlBonus * 0.02,
      };
    default:
      return NO_BONUSES;
  }
}

// XP awarded for game actions
export const HERO_XP = {
  systemDiscovered:  15,
  colonyFounded:     50,
  travelCompleted:   5,
  extractResources:  2,   // per 100 units extracted
  disputeWon:        100,
  asteoidHarvest:    3,   // per 100 units harvested
  laneBuilt:         25,
  gateBuilt:         40,
} as const;

/** Compute the level a hero should be at for a given total XP. */
export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 1; i < XP_FOR_LEVEL.length; i++) {
    if (xp >= XP_FOR_LEVEL[i]) level = i + 1;
    else break;
  }
  return Math.min(level, 20);
}

/** XP needed to reach the next level (0 if already max). */
export function xpToNextLevel(xp: number, level: number): number {
  if (level >= 20) return 0;
  return XP_FOR_LEVEL[level] - xp;
}

interface HeroRow {
  id: string;
  hero_class: HeroClass | null;
  hero_level: number;
  hero_xp: number;
  is_hero: boolean;
}

/**
 * Fetch the player's hero ship and return its bonuses.
 * Returns NO_BONUSES if the player has no hero ship yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPlayerHeroBonuses(admin: any, playerId: string): Promise<HeroBonuses> {
  const { data } = await admin
    .from("ships")
    .select("id, hero_class, hero_level, hero_xp, is_hero")
    .eq("owner_id", playerId)
    .eq("is_hero", true)
    .maybeSingle();

  const hero = data as HeroRow | null;
  if (!hero) return NO_BONUSES;
  return heroBonusesForClass(hero.hero_class, hero.hero_level);
}

/**
 * Award XP to a player's hero ship and level it up if the threshold is crossed.
 * Fire-and-forget safe — caller should void + catch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function awardHeroXp(admin: any, playerId: string, xp: number): Promise<void> {
  if (xp <= 0) return;

  const { data: hero } = await admin
    .from("ships")
    .select("id, hero_xp, hero_level")
    .eq("owner_id", playerId)
    .eq("is_hero", true)
    .maybeSingle();

  if (!hero) return;

  const newXp = (hero.hero_xp ?? 0) + xp;
  const newLevel = levelForXp(newXp);

  await admin
    .from("ships")
    .update({ hero_xp: newXp, hero_level: newLevel })
    .eq("id", hero.id);
}
