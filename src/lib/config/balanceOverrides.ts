/**
 * Runtime balance overrides.
 *
 * Reads the `balance_overrides` table and merges values into a deep copy of
 * BALANCE. Keys use dot-notation, e.g.:
 *   "asteroids.baseHarvestUnitsPerHr"   → sets BALANCE.asteroids.baseHarvestUnitsPerHr
 *   "colony.taxPerHourByTier.2"          → sets BALANCE.colony.taxPerHourByTier[2]
 *
 * Call `getBalanceWithOverrides(admin)` on the server in any handler that needs
 * live-editable values. Import BALANCE directly when overrides are not needed.
 *
 * Caches results for 60 seconds to avoid per-request DB hits.
 */

import { BALANCE } from "./balance";

// ---------------------------------------------------------------------------
// Deep clone + patch helpers
// ---------------------------------------------------------------------------

type DeepObj = { [k: string]: unknown };

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/** Apply a dot-notation key override into obj in place. */
function applyOverride(obj: DeepObj, key: string, value: unknown): void {
  const parts = key.split(".");
  let cursor: DeepObj = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof cursor[part] !== "object" || cursor[part] === null) return; // path doesn't exist
    cursor = cursor[part] as DeepObj;
  }
  const last = parts[parts.length - 1];
  // If cursor is an array and last is a numeric string, write to the index
  if (Array.isArray(cursor) && /^\d+$/.test(last)) {
    (cursor as unknown[])[parseInt(last)] = value;
  } else {
    cursor[last] = value;
  }
}

// ---------------------------------------------------------------------------
// Cache (module-level singleton — safe for Node.js server)
// ---------------------------------------------------------------------------

let cachedBalance: typeof BALANCE | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60_000; // 60 s

export type BalanceConfig = typeof BALANCE;

/**
 * Returns the BALANCE config merged with any active DB overrides.
 * Pass an admin Supabase client (service-role); the call is fire-and-forget
 * safe — if the DB is unavailable it falls back to the static config.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getBalanceWithOverrides(admin: any): Promise<BalanceConfig> {
  const now = Date.now();
  if (cachedBalance && now < cacheExpiresAt) return cachedBalance;

  try {
    const { data, error } = await admin
      .from("balance_overrides")
      .select("key, value");

    if (error || !data || data.length === 0) {
      // Nothing in DB — use static config (still cache to avoid repeated hits)
      cachedBalance = BALANCE;
      cacheExpiresAt = now + CACHE_TTL_MS;
      return BALANCE;
    }

    const merged = deepClone(BALANCE) as DeepObj;
    for (const row of data as { key: string; value: unknown }[]) {
      applyOverride(merged, row.key, row.value);
    }
    cachedBalance = merged as BalanceConfig;
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedBalance;
  } catch {
    return BALANCE;
  }
}

/** Invalidate the cache (call after admin writes a balance override). */
export function invalidateBalanceCache(): void {
  cachedBalance = null;
  cacheExpiresAt = 0;
}

// ---------------------------------------------------------------------------
// Human-readable catalog of balance keys for the admin UI
// ---------------------------------------------------------------------------

export interface BalanceKey {
  key: string;
  label: string;
  description: string;
  type: "number" | "number[]" | "object";
  category: string;
}

export const BALANCE_KEYS: BalanceKey[] = [
  // Travel
  { key: "travel.baseSpeedLyPerHr",              label: "Base Ship Speed",                 description: "Base ly/hr for all ships before upgrades",         type: "number",   category: "Travel" },
  // Colony taxes
  { key: "colony.taxPerHourByTier",              label: "Tax/Hr by Tier (array)",          description: "Credits per hour at each colony tier (index = tier)", type: "number[]", category: "Colony" },
  { key: "colony.taxAccumulationCapHours",       label: "Tax Cap Hours",                   description: "Max hours of tax that can accumulate before capping",  type: "number",   category: "Colony" },
  { key: "colony.foundingCostIronDefault",       label: "Colony Founding Cost (default)",  description: "Iron required to found a colony (fallback)",          type: "number",   category: "Colony" },
  // Extraction / gathering
  { key: "extraction.baseUnitsPerHrPerTier",     label: "Extraction Rate/Hr/Tier",         description: "Base resource units extracted per hour per colony tier", type: "number", category: "Extraction" },
  { key: "extraction.accumulationCapHours",      label: "Extraction Cap Hours",            description: "Max hours of extraction that can accumulate",          type: "number",  category: "Extraction" },
  // Asteroids
  { key: "asteroids.baseHarvestUnitsPerHr",      label: "Asteroid Base Harvest/Hr",        description: "Base units harvested per hour without turrets",         type: "number",   category: "Asteroids" },
  { key: "asteroids.harvestUnitsPerHrPerTurretLevel", label: "Harvest Bonus/Turret Level", description: "Additional units/hr per turret level",                 type: "number",   category: "Asteroids" },
  { key: "asteroids.maxHarvestAccumulationHours",label: "Max Harvest Accumulation Hours",  description: "Cap on unresolved harvest hours",                      type: "number",   category: "Asteroids" },
  // Market
  { key: "market.listingFeePercent",             label: "Market Listing Fee %",            description: "Percentage fee on market listing value",               type: "number",   category: "Market" },
  { key: "market.defaultExpiryDays",             label: "Market Listing Expiry Days",      description: "Default days until a market listing expires",          type: "number",   category: "Market" },
  // Sol stipend
  { key: "solStipend.dailyCredits",              label: "Daily Sol Stipend",               description: "Credits granted daily to struggling players",          type: "number",   category: "Economy" },
  { key: "solStipend.creditThreshold",           label: "Stipend Credit Threshold",        description: "Players at or below this credit balance receive stipend", type: "number", category: "Economy" },
  // Emergency exchange
  { key: "emergencyExchange.markupMultiplier",   label: "EUX Markup Multiplier",           description: "Price multiplier applied to emergency exchange purchases", type: "number", category: "Economy" },
  { key: "emergencyExchange.dailyLimitUnits",    label: "EUX Daily Limit",                 description: "Max units purchasable per player per day via EUX",    type: "number",  category: "Economy" },
  // Lanes
  { key: "lanes.baseRangeLy",                    label: "Base Travel Range (ly)",          description: "Maximum travel range without lanes",                   type: "number",   category: "Lanes" },
  { key: "lanes.maxTransitTaxPercent",           label: "Max Lane Transit Tax %",          description: "Maximum tax % a lane owner can set",                  type: "number",   category: "Lanes" },
  { key: "lanes.constructionHours",              label: "Lane Construction Hours",         description: "Hours to build a hyperspace lane",                     type: "number",   category: "Lanes" },
  // Upkeep
  { key: "upkeep.periodHours",                   label: "Upkeep Period Hours",             description: "How often upkeep is charged",                          type: "number",   category: "Upkeep" },
  { key: "upkeep.foodPerTierPerPeriod",          label: "Food Upkeep/Tier/Period",         description: "Food consumed per tier per upkeep period",             type: "number",   category: "Upkeep" },
  { key: "upkeep.ironPerTierPerPeriod",          label: "Iron Upkeep/Tier/Period",         description: "Iron consumed per tier per upkeep period",             type: "number",   category: "Upkeep" },
  // Alliance
  { key: "alliance.createCostIron",              label: "Alliance Create Cost (iron)",     description: "Iron to form an alliance",                             type: "number",   category: "Alliance" },
  { key: "alliance.beaconPlaceCostIron",         label: "Beacon Placement Cost (iron)",    description: "Iron to place an alliance beacon",                     type: "number",   category: "Alliance" },
];
