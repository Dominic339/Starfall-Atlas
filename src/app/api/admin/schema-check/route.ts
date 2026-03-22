/**
 * GET /api/admin/schema-check
 *
 * Diagnostic endpoint: checks whether critical columns and tables exist
 * in the live Supabase database schema.
 *
 * SECURITY: protected by the ADMIN_REPAIR_KEY environment variable.
 * Set it in your Supabase project environment and pass it via the
 * x-repair-key request header.
 *
 * Usage:
 *   curl -H "x-repair-key: <ADMIN_REPAIR_KEY>" \
 *        https://your-app.vercel.app/api/admin/schema-check
 *
 * Returns JSON with:
 *   { ok: true, checks: { passed: [...], failed: [...] }, playerStats: {...} }
 */

import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  // ── Auth: require ADMIN_REPAIR_KEY ────────────────────────────────────────
  const key = request.headers.get("x-repair-key");
  const expected = process.env.ADMIN_REPAIR_KEY;

  if (!expected || !key || key !== expected) {
    return Response.json(
      { ok: false, error: "Forbidden. Provide x-repair-key header." },
      { status: 403 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const passed: string[] = [];
  const failed: string[] = [];

  // ── Helper: probe for a column by running a targeted query ────────────────
  // We SELECT 1 FROM information_schema.columns to avoid touching row data.
  async function checkColumn(table: string, column: string): Promise<void> {
    try {
      const { data, error } = await admin.rpc("exec_sql", {
        sql: `SELECT 1 FROM information_schema.columns WHERE table_name='${table}' AND column_name='${column}'`,
      });
      // Fallback: try selecting the column directly from the table
      if (error) throw error;
      const exists = Array.isArray(data) && data.length > 0;
      if (exists) passed.push(`${table}.${column}`);
      else failed.push(`${table}.${column} — MISSING`);
    } catch {
      // rpc exec_sql may not be available — use a SELECT probe instead
      try {
        const probe = await admin.from(table).select(column).limit(0);
        if (probe.error) {
          failed.push(`${table}.${column} — ERROR: ${String(probe.error.message)}`);
        } else {
          passed.push(`${table}.${column}`);
        }
      } catch (e) {
        failed.push(`${table}.${column} — UNKNOWN (${String(e)})`);
      }
    }
  }

  async function checkTable(table: string): Promise<void> {
    const probe = await admin.from(table).select("id").limit(0);
    if (probe.error && String(probe.error.message).toLowerCase().includes("does not exist")) {
      failed.push(`TABLE ${table} — MISSING`);
    } else {
      passed.push(`TABLE ${table}`);
    }
  }

  // ── Probe critical schema items ───────────────────────────────────────────

  // Core tables
  await checkTable("players");
  await checkTable("ships");
  await checkTable("player_stations");
  await checkTable("colonies");
  await checkTable("travel_jobs");
  await checkTable("resource_inventory");
  await checkTable("survey_results");
  await checkTable("system_discoveries");
  await checkTable("player_research");
  await checkTable("fleets");
  await checkTable("player_fleet_slots");
  await checkTable("colony_routes");
  await checkTable("colony_transports");
  await checkTable("alliances");
  await checkTable("alliance_members");
  await checkTable("alliance_beacons");
  await checkTable("disputes");

  // Critical colony columns
  await checkColumn("colonies", "status");
  await checkColumn("colonies", "abandoned_at");
  await checkColumn("colonies", "collapsed_at");
  await checkColumn("colonies", "last_extract_at");
  await checkColumn("colonies", "last_upkeep_at");
  await checkColumn("colonies", "upkeep_missed_periods");

  // Critical ships columns
  await checkColumn("ships", "dispatch_mode");
  await checkColumn("ships", "auto_state");
  await checkColumn("ships", "auto_target_colony_id");
  await checkColumn("ships", "hull_level");
  await checkColumn("ships", "engine_level");
  await checkColumn("ships", "cargo_level");

  // Player profile columns
  await checkColumn("players", "sol_stipend_last_at");
  await checkColumn("players", "deactivated_at");
  await checkColumn("players", "title");
  await checkColumn("players", "first_colony_placed");

  // Alliance columns
  await checkColumn("alliances", "tag");
  await checkColumn("alliances", "invite_code");

  // ── Player/ship data stats ────────────────────────────────────────────────
  let playerStats: Record<string, unknown> = {};
  try {
    const { count: playerCount } = await admin.from("players").select("id", { count: "exact", head: true });
    const { count: stationCount } = await admin.from("player_stations").select("id", { count: "exact", head: true });
    const { count: shipCount } = await admin.from("ships").select("id", { count: "exact", head: true });

    // Players without a station
    const { data: playerIds } = await admin.from("players").select("id");
    const { data: stationOwnerIds } = await admin.from("player_stations").select("owner_id");
    const stationSet = new Set((stationOwnerIds ?? []).map((r: { owner_id: string }) => r.owner_id));
    const playersWithoutStation = (playerIds ?? []).filter(
      (r: { id: string }) => !stationSet.has(r.id),
    ).length;

    playerStats = {
      totalPlayers: playerCount ?? "unknown",
      totalStations: stationCount ?? "unknown",
      totalShips: shipCount ?? "unknown",
      playersWithoutStation,
      expectedShipsPerPlayer: 2,
      note: `If totalShips > totalPlayers × 2, duplicate ships likely exist.`,
    };
  } catch (e) {
    playerStats = { error: String(e) };
  }

  return Response.json({
    ok: true,
    summary: {
      passedCount: passed.length,
      failedCount: failed.length,
      status: failed.length === 0 ? "SCHEMA OK" : "SCHEMA ISSUES FOUND",
    },
    checks: { passed, failed },
    playerStats,
    instructions: failed.length > 0
      ? "Run migration 00030_phase28_repair.sql in Supabase SQL editor to fix missing columns/tables."
      : "Schema looks complete. If colony founding still fails, try NOTIFY pgrst, 'reload schema'; in the SQL editor.",
  });
}
