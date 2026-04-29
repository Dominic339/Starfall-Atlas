/**
 * POST /api/game/travel/intercept
 *
 * Initiates combat against an enemy in-transit travel job.
 * Combat power = ship count × base speed. Winner determined by power ratio.
 * - Attacker wins: defender loses one ship (deleted); attacker loots cargo credits.
 * - Draw (within 20% power): both lose one ship.
 * - Defender wins: attacker loses one ship.
 *
 * A combat_report is inserted and a message is sent to both players.
 *
 * Body: { travelJobId: string }  — the enemy travel_jobs.id to attack
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, parseInput, toErrorResponse } from "@/lib/actions/helpers";
import { fail } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listResult, maybeSingleResult } from "@/lib/supabase/utils";

export const dynamic = "force-dynamic";

const InterceptSchema = z.object({
  travelJobId: z.string().uuid(),
});

const LOOT_PER_SHIP = 50; // credits looted per defender ship lost

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return toErrorResponse(auth.error);
  const { player: attacker } = auth.data;

  const body = await req.json().catch(() => ({}));
  const input = parseInput(InterceptSchema, body);
  if (!input.ok) return toErrorResponse(input.error);
  const { travelJobId } = input.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Verify the target job exists, is pending, and does NOT belong to the attacker
  const { data: targetJob } = maybeSingleResult<{
    id: string; player_id: string; fleet_id: string | null; ship_id: string;
    from_system_id: string; to_system_id: string;
  }>(
    await admin
      .from("travel_jobs")
      .select("id, player_id, fleet_id, ship_id, from_system_id, to_system_id")
      .eq("id", travelJobId)
      .eq("status", "pending")
      .maybeSingle(),
  );

  if (!targetJob) return toErrorResponse(fail("not_found", "Target travel job not found.").error);
  if (targetJob.player_id === attacker.id) return toErrorResponse(fail("invalid_target", "Cannot attack your own ships.").error);

  // Count attacker's in-transit or docked ships (combat power = ship count × speed)
  const { data: attackerShips } = listResult<{ id: string; speed_ly_per_hr: number }>(
    await admin.from("ships").select("id, speed_ly_per_hr").eq("owner_id", attacker.id),
  );
  const attackerShipCount = (attackerShips ?? []).length;
  const attackerSpeed     = (attackerShips ?? [])[0]?.speed_ly_per_hr ?? 10;
  const attackerPower     = attackerShipCount * attackerSpeed;

  // Count defender's ships in the same fleet (or just that one ship)
  let defenderShipCount = 1;
  let defenderSpeed     = 10;
  if (targetJob.fleet_id) {
    const { data: fleetJobs } = listResult<{ ship_id: string }>(
      await admin.from("travel_jobs").select("ship_id").eq("fleet_id", targetJob.fleet_id).eq("status", "pending"),
    );
    defenderShipCount = (fleetJobs ?? []).length || 1;
    const { data: defShips } = listResult<{ speed_ly_per_hr: number }>(
      await admin.from("ships").select("speed_ly_per_hr").in("id", (fleetJobs ?? []).map((j) => j.ship_id)).limit(1),
    );
    defenderSpeed = defShips?.[0]?.speed_ly_per_hr ?? 10;
  } else {
    const { data: defShip } = maybeSingleResult<{ speed_ly_per_hr: number }>(
      await admin.from("ships").select("speed_ly_per_hr").eq("id", targetJob.ship_id).maybeSingle(),
    );
    defenderSpeed = defShip?.speed_ly_per_hr ?? 10;
  }
  const defenderPower = defenderShipCount * defenderSpeed;

  if (attackerPower <= 0) return toErrorResponse(fail("invalid_target", "You have no ships to attack with.").error);

  // Determine outcome based on power ratio
  const ratio = attackerPower / (attackerPower + defenderPower);
  let outcome: "attacker_wins" | "defender_wins" | "draw";
  let attackerShipsLost = 0;
  let defenderShipsLost = 0;
  let creditsLooted     = 0;

  if (ratio >= 0.6) {
    outcome = "attacker_wins";
    defenderShipsLost = 1;
    creditsLooted     = defenderShipsLost * LOOT_PER_SHIP;
  } else if (ratio <= 0.4) {
    outcome = "defender_wins";
    attackerShipsLost = 1;
  } else {
    outcome = "draw";
    attackerShipsLost = 1;
    defenderShipsLost = 1;
    creditsLooted     = LOOT_PER_SHIP / 2;
  }

  // Apply losses: delete one defender ship on attacker win / draw
  if (defenderShipsLost > 0 && targetJob.ship_id) {
    await admin.from("ships").delete().eq("id", targetJob.ship_id);
    // Cancel that ship's travel job
    await admin.from("travel_jobs").update({ status: "cancelled" }).eq("id", travelJobId);
  }

  // Delete one attacker ship on defender win / draw (pick first ship)
  if (attackerShipsLost > 0 && attackerShips && attackerShips.length > 0) {
    const sacrificeShip = attackerShips[0];
    await admin.from("ships").delete().eq("id", sacrificeShip.id);
    // Cancel any pending travel job for that ship
    await admin.from("travel_jobs").update({ status: "cancelled" }).eq("ship_id", sacrificeShip.id).eq("status", "pending");
  }

  // Transfer looted credits
  if (creditsLooted > 0) {
    await admin.from("players").update({ credits: attacker.credits + creditsLooted }).eq("id", attacker.id);
    // Fetch defender credits and deduct
    const { data: defender } = maybeSingleResult<{ id: string; credits: number }>(
      await admin.from("players").select("id, credits").eq("id", targetJob.player_id).maybeSingle(),
    );
    if (defender) {
      await admin.from("players").update({ credits: Math.max(0, defender.credits - creditsLooted) }).eq("id", defender.id);
    }
  }

  // Insert combat report
  await admin.from("combat_reports").insert({
    attacker_id: attacker.id,
    defender_id: targetJob.player_id,
    system_id: targetJob.to_system_id,
    outcome,
    attacker_power: Math.round(attackerPower),
    defender_power: Math.round(defenderPower),
    attacker_ships_lost: attackerShipsLost,
    defender_ships_lost: defenderShipsLost,
    credits_looted: creditsLooted,
  });

  // Send in-game message to defender
  const defenderMsg = `Combat report: ${attacker.handle}'s fleet intercepted your fleet near system ${targetJob.to_system_id}. Outcome: ${outcome.replace(/_/g, " ")}. Your ships lost: ${defenderShipsLost}.`;
  if (targetJob.player_id !== attacker.id) {
    await admin.from("player_messages").insert({
      sender_id: attacker.id,
      recipient_id: targetJob.player_id,
      subject: "Combat Report",
      body: defenderMsg,
    });
  }

  return Response.json({
    ok: true,
    data: {
      outcome,
      attackerPower: Math.round(attackerPower),
      defenderPower: Math.round(defenderPower),
      attackerShipsLost,
      defenderShipsLost,
      creditsLooted,
    },
  });
}
