"use client";

/**
 * Client-side colony actions for the game dashboard.
 *
 * CollectButton  — collect accrued taxes into player credit balance.
 * ExtractButton  — extract accrued resources into station inventory.
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

// ---------------------------------------------------------------------------
// Extract resources button
// ---------------------------------------------------------------------------

interface ExtractButtonProps {
  colonyId: string;
  /** Pre-formatted summary string, e.g. "5 iron, 3 carbon" */
  summary: string;
}

export function ExtractButton({ colonyId, summary }: ExtractButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const router = useRouter();

  async function handleExtract() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/game/colony/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId }),
      });

      const json = await res.json();

      if (!json.ok) {
        setError(json.error?.message ?? "Extraction failed.");
        return;
      }

      const amounts = json.data.extracted as {
        resource_type: string;
        quantity: number;
      }[];
      const text =
        amounts.length > 0
          ? amounts.map((a) => `${a.quantity} ${a.resource_type}`).join(", ")
          : "nothing ready yet";

      setResultText(text);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (resultText !== null) {
    return (
      <span className="text-xs font-medium text-teal-400">
        Extracted: {resultText}
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleExtract}
        disabled={loading}
        className="rounded bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Extracting…" : `Extract (${summary})`}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
