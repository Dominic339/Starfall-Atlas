/**
 * /game — Galaxy Map (Phase 21)
 *
 * The galaxy map is now the primary game surface.
 * The old command-centre dashboard is at /game/command.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function GamePage() {
  redirect("/game/map");
}
