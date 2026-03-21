"use client";

/**
 * Client components for colony structure building.
 *
 * BuildStructureButton — triggers POST /api/game/colony/build-structure
 * and refreshes the page on success.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface BuildStructureButtonProps {
  colonyId: string;
  structureType: "warehouse" | "extractor" | "habitat_module";
  targetTier: number;
  ironCost: number;
  carbonCost: number;
  canAfford: boolean;
  label: string;
}

export function BuildStructureButton({
  colonyId,
  structureType,
  targetTier,
  ironCost,
  carbonCost,
  canAfford,
  label,
}: BuildStructureButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleBuild() {
    if (loading || !canAfford) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/colony/build-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId, structureType }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
      } else {
        setError(json.error?.message ?? "Build failed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const costLabel = `${ironCost}⛏ ${carbonCost}◈`;

  return (
    <div className="space-y-0.5">
      <button
        onClick={handleBuild}
        disabled={loading || !canAfford}
        title={`Build ${label} (tier ${targetTier}): costs ${ironCost} iron, ${carbonCost} carbon`}
        className={`rounded px-2 py-0.5 text-xs font-medium transition-colors
          ${canAfford && !loading
            ? "bg-teal-900/60 text-teal-300 hover:bg-teal-800/60 cursor-pointer"
            : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
          }
          disabled:opacity-60`}
      >
        {loading ? "Building…" : `${label} · ${costLabel}`}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
