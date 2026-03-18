"use client";

/**
 * Client-side colony actions for the game dashboard.
 *
 * CollectButton: calls POST /api/game/colony/collect and refreshes
 * the page to show the updated credit balance.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Collect taxes button
// ---------------------------------------------------------------------------

interface CollectButtonProps {
  colonyId: string;
  accrued: number;
}

export function CollectButton({ colonyId, accrued }: CollectButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collected, setCollected] = useState<number | null>(null);
  const router = useRouter();

  async function handleCollect() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/game/colony/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId }),
      });

      const json = await res.json();

      if (!json.ok) {
        setError(json.error?.message ?? "Collection failed.");
        return;
      }

      setCollected(json.data.creditsCollected);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (collected !== null && collected > 0) {
    return (
      <span className="text-xs font-medium text-emerald-400">
        +{collected} collected
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleCollect}
        disabled={loading || accrued === 0}
        className="rounded bg-amber-700 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Collecting…" : `Collect ${accrued} ¢`}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
