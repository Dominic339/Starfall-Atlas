import { BALANCE } from "@/lib/config/balance";
import { refreshInfluenceCache } from "@/lib/game/influence";

const { thresholdDays, resolutionWindowDays } = BALANCE.inactivity;
const THRESHOLD_MS      = thresholdDays      * 24 * 3_600_000;
const WINDOW_MS         = resolutionWindowDays * 24 * 3_600_000;

type ColonyRow = {
  id: string;
  system_id: string;
  status: string;
  abandoned_at: string | null;
  population_tier: number;
};

/**
 * Per-player lazy inactivity resolution. Called on every authenticated page
 * load (inside runEngineTick) BEFORE updating last_active_at.
 *
 * Logic (all thresholds measured from last_active_at / abandoned_at):
 *
 *   1. If now − last_active_at ≥ thresholdDays (30):
 *        → Mark all ACTIVE colonies as abandoned.
 *          abandoned_at = last_active_at + thresholdDays  (retrospective)
 *
 *   2. For every ABANDONED colony:
 *        a. If now − abandoned_at ≥ resolutionWindowDays (7):
 *             → Collapse: status='collapsed', clear resource_inventory, log event.
 *        b. Else (player is visiting within the window):
 *             → Reactivate: status='active', re-enable structures, log event.
 *
 *   3. Refresh influence cache + trigger contested-revert check for all
 *      systems that had abandonment or collapse activity.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolvePlayerInactivity(admin: any, playerId: string, now: Date): Promise<void> {
  // ── Fetch player's last_active_at ─────────────────────────────────────────
  const { data: playerRow } = await admin
    .from("players")
    .select("last_active_at")
    .eq("id", playerId)
    .maybeSingle();

  if (!playerRow) return;
  const lastActive = new Date((playerRow as { last_active_at: string }).last_active_at);

  // ── Step 1: Abandon active colonies if threshold exceeded ─────────────────
  if (now.getTime() - lastActive.getTime() >= THRESHOLD_MS) {
    const { data: activeRaw } = await admin
      .from("colonies")
      .select("id, system_id, status, abandoned_at, population_tier")
      .eq("owner_id", playerId)
      .eq("status", "active");

    const active = (activeRaw ?? []) as ColonyRow[];
    if (active.length > 0) {
      // abandoned_at is retrospective: when they actually crossed the threshold
      const abandonedAt = new Date(lastActive.getTime() + THRESHOLD_MS).toISOString();
      const ids = active.map((c) => c.id);

      await admin
        .from("colonies")
        .update({ status: "abandoned", abandoned_at: abandonedAt })
        .in("id", ids);

      // Deactivate all structures in these colonies
      await admin
        .from("structures")
        .update({ is_active: false })
        .in("colony_id", ids);

      // Log world events
      await admin.from("world_events").insert(
        active.map((c) => ({
          event_type: "colony_abandoned",
          player_id:  playerId,
          system_id:  c.system_id,
          body_id:    null,
          metadata:   { colony_id: c.id, population_tier: c.population_tier },
        })),
      );
    }
  }

  // ── Step 2: Process all abandoned colonies ────────────────────────────────
  const { data: abandonedRaw } = await admin
    .from("colonies")
    .select("id, system_id, status, abandoned_at, population_tier")
    .eq("owner_id", playerId)
    .eq("status", "abandoned");

  const abandoned = (abandonedRaw ?? []) as ColonyRow[];
  if (abandoned.length === 0) return;

  const toCollapse:   ColonyRow[] = [];
  const toReactivate: ColonyRow[] = [];

  for (const c of abandoned) {
    const abandonedAt = c.abandoned_at ? new Date(c.abandoned_at) : now;
    if (now.getTime() - abandonedAt.getTime() >= WINDOW_MS) {
      toCollapse.push(c);
    } else {
      toReactivate.push(c);
    }
  }

  // ── Collapse ─────────────────────────────────────────────────────────────
  if (toCollapse.length > 0) {
    const collapseIds = toCollapse.map((c) => c.id);

    await admin
      .from("colonies")
      .update({ status: "collapsed", collapsed_at: now.toISOString() })
      .in("id", collapseIds);

    // Clear colony resource inventory (inventory is lost on collapse)
    await admin
      .from("resource_inventory")
      .delete()
      .eq("location_type", "colony")
      .in("location_id", collapseIds);

    await admin.from("world_events").insert(
      toCollapse.map((c) => ({
        event_type: "colony_collapsed",
        player_id:  playerId,
        system_id:  c.system_id,
        body_id:    null,
        metadata:   { colony_id: c.id },
      })),
    );
  }

  // ── Reactivate (player is back within the window) ─────────────────────────
  if (toReactivate.length > 0) {
    const reactivateIds = toReactivate.map((c) => c.id);

    await admin
      .from("colonies")
      .update({ status: "active", abandoned_at: null })
      .in("id", reactivateIds);

    // Re-enable structures
    await admin
      .from("structures")
      .update({ is_active: true })
      .in("colony_id", reactivateIds);

    await admin.from("world_events").insert(
      toReactivate.map((c) => ({
        event_type: "colony_reactivated",
        player_id:  playerId,
        system_id:  c.system_id,
        body_id:    null,
        metadata:   { colony_id: c.id },
      })),
    );
  }

  // ── Refresh influence caches for all affected systems ─────────────────────
  const affectedSystems = new Set(
    [...toCollapse, ...toReactivate].map((c) => c.system_id),
  );

  await Promise.all(
    Array.from(affectedSystems).map((sid) =>
      refreshInfluenceCache(admin, sid).catch(() => undefined),
    ),
  );
}

/**
 * Updates last_active_at to the current time.
 * Must be called AFTER resolvePlayerInactivity so the inactivity check
 * uses the player's true last visit time, not the current one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function touchPlayerActivity(admin: any, playerId: string, now: Date): Promise<void> {
  await admin
    .from("players")
    .update({ last_active_at: now.toISOString() })
    .eq("id", playerId);
}
