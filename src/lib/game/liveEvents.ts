/**
 * Live events engine — reads active events and exposes gameplay multipliers.
 *
 * All functions are pure given the events list; the DB call happens once
 * per request in the API route. Results are not cached here because the
 * 60-second balance-override cache is already the pattern for hot paths.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventType =
  | "special_asteroid"
  | "harvest_boost"
  | "credit_bonus"
  | "resource_node"
  | "double_drop"
  | "currency_event";

export interface LiveEventRow {
  id: string;
  type: EventType;
  config: Record<string, unknown>;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  system_ids: string[] | null;
  entry_cost_credits: number | null;
  entry_cost_premium: number | null;
}

// ---------------------------------------------------------------------------
// DB fetch
// ---------------------------------------------------------------------------

/**
 * Fetch all currently active live events.
 * Pass an admin Supabase client (service-role).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getActiveLiveEvents(admin: any, now: Date = new Date()): Promise<LiveEventRow[]> {
  const iso = now.toISOString();
  const { data } = await admin
    .from("live_events")
    .select("id, type, config, starts_at, ends_at, is_active, system_ids, entry_cost_credits, entry_cost_premium")
    .eq("is_active", true)
    .lte("starts_at", iso)
    .gte("ends_at", iso);

  return (data ?? []) as LiveEventRow[];
}

// ---------------------------------------------------------------------------
// Gameplay multipliers
// ---------------------------------------------------------------------------

/**
 * Combined harvest power multiplier from all active harvest_boost events.
 * Returns 1.0 when no events are active.
 */
export function harvestBoostMultiplier(
  events: LiveEventRow[],
  systemId?: string,
): number {
  let mult = 1.0;
  for (const e of events) {
    if (e.type !== "harvest_boost") continue;
    if (systemId && e.system_ids && e.system_ids.length > 0 && !e.system_ids.includes(systemId)) continue;
    const m = (e.config.multiplier as number | undefined) ?? 1;
    mult *= m;
  }
  return mult;
}

/**
 * Combined extraction/drop multiplier from all active double_drop events.
 * Returns 1.0 when no events are active.
 */
export function dropMultiplier(
  events: LiveEventRow[],
  systemId?: string,
): number {
  let mult = 1.0;
  for (const e of events) {
    if (e.type !== "double_drop") continue;
    if (systemId && e.system_ids && e.system_ids.length > 0 && !e.system_ids.includes(systemId)) continue;
    const m = (e.config.multiplier as number | undefined) ?? 2;
    mult *= m;
  }
  return mult;
}

/**
 * Bonus credit multiplier from all active credit_bonus events.
 * A credit_bonus with bonus_percent=50 returns 1.5.
 * Returns 1.0 when no events are active.
 */
export function creditBonusMultiplier(events: LiveEventRow[]): number {
  let bonus = 0;
  for (const e of events) {
    if (e.type !== "credit_bonus") continue;
    const pct = (e.config.bonus_percent as number | undefined) ?? 0;
    bonus += pct;
  }
  return 1 + bonus / 100;
}
