"use client";

/**
 * DevControls — dev panel rendered on the Command Centre.
 *
 * Shown when:
 *   - player.is_dev = TRUE in the DB  (works in any environment)
 *   - OR process.env.NODE_ENV !== 'production'  (legacy — non-prod envs)
 *
 * The parent server component checks both conditions and only renders this
 * component if at least one is true.
 *
 * Features:
 *   - Complete Travel Now: fast-forwards all pending travel to arrival
 *   - Grant Resources: adds resources to station or colony inventory
 *     (gated by the dev_grant_resources Postgres RPC which checks is_dev)
 */

import { useState } from "react";

// All resource types the grant UI exposes (subset — most-used in testing)
const RESOURCE_OPTIONS = [
  "iron",
  "carbon",
  "ice",
  "food",
  "silica",
  "water",
  "biomass",
  "sulfur",
  "steel",
  "rare_crystal",
] as const;

type ResourceOption = (typeof RESOURCE_OPTIONS)[number];

interface DevControlsProps {
  pendingTravelCount: number;
  stationId: string | null;
  isDev: boolean;
}

export function DevControls({ pendingTravelCount, stationId, isDev }: DevControlsProps) {
  // ── Complete Travel ───────────────────────────────────────────────────────
  const [travelLoading, setTravelLoading] = useState(false);
  const [travelMessage, setTravelMessage] = useState<string | null>(null);

  async function completeTravelNow() {
    setTravelLoading(true);
    setTravelMessage(null);
    try {
      const res = await fetch("/api/dev/travel/complete", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        const { completed, loaded, unloaded } = json.data;
        const parts: string[] = [`${completed} trip${completed !== 1 ? "s" : ""} completed`];
        if (loaded > 0) parts.push(`${loaded} loaded`);
        if (unloaded > 0) parts.push(`${unloaded} unloaded to station`);
        setTravelMessage(parts.join(" · ") + ". Refresh to see updated state.");
      } else {
        setTravelMessage(`Error: ${json.error?.message ?? "Unknown error"}`);
      }
    } catch {
      setTravelMessage("Network error.");
    } finally {
      setTravelLoading(false);
    }
  }

  // ── Grant Resources ───────────────────────────────────────────────────────
  const [grantResource, setGrantResource] = useState<ResourceOption>("iron");
  const [grantQty, setGrantQty] = useState<string>("500");
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantMessage, setGrantMessage] = useState<string | null>(null);

  async function grantResources() {
    if (!stationId) {
      setGrantMessage("No station found.");
      return;
    }
    const qty = parseInt(grantQty, 10);
    if (isNaN(qty) || qty <= 0) {
      setGrantMessage("Enter a positive quantity.");
      return;
    }
    setGrantLoading(true);
    setGrantMessage(null);
    try {
      const res = await fetch("/api/dev/grant-resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationType: "station",
          locationId: stationId,
          resources: [{ resourceType: grantResource, quantity: qty }],
        }),
      });
      const json = await res.json();
      if (json.ok) {
        const g = json.data.granted[0];
        setGrantMessage(`+${g.quantity} ${g.resourceType} added to station. Refresh to see.`);
      } else {
        setGrantMessage(`Error: ${json.error?.message ?? "Unknown error"}`);
      }
    } catch {
      setGrantMessage("Network error.");
    } finally {
      setGrantLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-yellow-800/60 bg-yellow-950/20 px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-yellow-500">Dev Controls</span>
        {isDev && (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-yellow-900/40 text-yellow-400 border border-yellow-700/40">
            Dev Account
          </span>
        )}
      </div>

      {/* Complete Travel */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={completeTravelNow}
          disabled={travelLoading || pendingTravelCount === 0}
          className="rounded border border-yellow-700/60 bg-yellow-900/30 px-3 py-1.5 text-xs font-medium text-yellow-300 hover:bg-yellow-800/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {travelLoading ? "Completing…" : `Complete Travel Now (${pendingTravelCount} pending)`}
        </button>
        {travelMessage && (
          <span className="text-xs text-yellow-400">{travelMessage}</span>
        )}
      </div>

      {/* Grant Resources — only if player is a dev account */}
      {isDev && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-yellow-600">Grant to station:</span>
          <select
            value={grantResource}
            onChange={(e) => setGrantResource(e.target.value as ResourceOption)}
            className="rounded border border-yellow-700/40 bg-yellow-950/40 px-2 py-1 text-xs text-yellow-200 focus:outline-none"
          >
            {RESOURCE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <input
            type="number"
            value={grantQty}
            onChange={(e) => setGrantQty(e.target.value)}
            min={1}
            max={1_000_000}
            className="w-20 rounded border border-yellow-700/40 bg-yellow-950/40 px-2 py-1 text-xs text-yellow-200 focus:outline-none"
          />
          <button
            onClick={grantResources}
            disabled={grantLoading || !stationId}
            className="rounded border border-yellow-700/60 bg-yellow-900/30 px-3 py-1.5 text-xs font-medium text-yellow-300 hover:bg-yellow-800/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {grantLoading ? "Granting…" : "Grant"}
          </button>
          {grantMessage && (
            <span className="text-xs text-yellow-400">{grantMessage}</span>
          )}
        </div>
      )}
    </div>
  );
}
