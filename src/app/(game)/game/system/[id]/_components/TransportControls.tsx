"use client";

/**
 * Colony transport controls — Phase 18.
 *
 * TransportPanel: shows transport summary + purchase/upgrade buttons for a colony.
 * Uses the server-authoritative APIs:
 *   POST /api/game/colony/transport/purchase
 *   POST /api/game/colony/transport/upgrade
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BALANCE } from "@/lib/config/balance";
import { transportSummary, tierCapacity } from "@/lib/game/transportCapacity";

interface TransportRow {
  id: string;
  tier: number;
}

interface TransportPanelProps {
  colonyId: string;
  transports: TransportRow[];
  /** Iron available at station (for affordability display). */
  stationIron: number;
  /** Carbon available at station. */
  stationCarbon: number;
  /** Steel available at station. */
  stationSteel: number;
}

export function TransportPanel({
  colonyId,
  transports,
  stationIron,
  stationCarbon,
  stationSteel,
}: TransportPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<"purchase" | "upgrade" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lowest-tier transport eligible for upgrade
  const upgradeable = [...transports].sort((a, b) => a.tier - b.tier).find((t) => t.tier < 5);
  const upgradeTargetTier = upgradeable ? upgradeable.tier + 1 : null;
  const upgradeCost = upgradeTargetTier
    ? BALANCE.colonyTransport.upgradeCosts[upgradeTargetTier]
    : null;

  const purchaseCost = BALANCE.colonyTransport.purchaseCostIron;
  const canAffordPurchase = stationIron >= purchaseCost;
  const canAffordUpgrade = upgradeCost
    ? stationIron >= upgradeCost.iron &&
      stationCarbon >= upgradeCost.carbon &&
      stationSteel >= upgradeCost.steel
    : false;

  async function handlePurchase() {
    setLoading("purchase");
    setError(null);
    try {
      const res = await fetch("/api/game/colony/transport/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
      } else {
        setError(json.error?.message ?? "Purchase failed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(null);
    }
  }

  async function handleUpgrade() {
    setLoading("upgrade");
    setError(null);
    try {
      const res = await fetch("/api/game/colony/transport/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
      } else {
        setError(json.error?.message ?? "Upgrade failed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(null);
    }
  }

  const summary = transportSummary(transports);

  return (
    <div className="space-y-1.5">
      {/* Summary line */}
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs ${transports.length === 0 ? "text-amber-600" : "text-zinc-400"}`}>
          {summary}
        </span>

        {/* Tier breakdown chips */}
        {transports.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {[1, 2, 3, 4, 5].map((tier) => {
              const count = transports.filter((t) => t.tier === tier).length;
              if (count === 0) return null;
              return (
                <span
                  key={tier}
                  className="rounded bg-zinc-800 px-1 py-0.5 text-xs text-zinc-400"
                  title={`${tierCapacity(tier)} units/period each`}
                >
                  T{tier}×{count}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {/* Purchase */}
        <button
          onClick={handlePurchase}
          disabled={loading !== null || !canAffordPurchase}
          className={`rounded border px-2 py-1 text-xs transition-colors
            ${canAffordPurchase
              ? "border-emerald-800 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-900/50"
              : "border-zinc-800 bg-zinc-900/40 text-zinc-600 cursor-not-allowed"
            }
            disabled:opacity-60`}
          title={`Buy T1 transport · ${purchaseCost} iron`}
        >
          {loading === "purchase" ? "Buying…" : `Buy T1 transport · ${purchaseCost} iron`}
        </button>

        {/* Upgrade */}
        {upgradeable && upgradeCost && (
          <button
            onClick={handleUpgrade}
            disabled={loading !== null || !canAffordUpgrade}
            className={`rounded border px-2 py-1 text-xs transition-colors
              ${canAffordUpgrade
                ? "border-indigo-800 bg-indigo-950/40 text-indigo-400 hover:bg-indigo-900/50"
                : "border-zinc-800 bg-zinc-900/40 text-zinc-600 cursor-not-allowed"
              }
              disabled:opacity-60`}
            title={`Upgrade T${upgradeable.tier} → T${upgradeTargetTier} · ${upgradeCost.iron}i ${upgradeCost.carbon}c${upgradeCost.steel > 0 ? ` ${upgradeCost.steel}st` : ""}`}
          >
            {loading === "upgrade"
              ? "Upgrading…"
              : `T${upgradeable.tier}→T${upgradeTargetTier} · ${upgradeCost.iron}i${upgradeCost.carbon > 0 ? ` ${upgradeCost.carbon}c` : ""}${upgradeCost.steel > 0 ? ` ${upgradeCost.steel}st` : ""}`}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
