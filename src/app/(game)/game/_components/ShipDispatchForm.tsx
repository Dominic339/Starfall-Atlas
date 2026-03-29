"use client";

/**
 * ShipDispatchForm — lets the player dispatch a specific ship to a target system.
 *
 * Used by the Station page to dispatch any docked ship from a dropdown of
 * reachable systems. Calls POST /api/game/travel with an explicit shipId so
 * the correct ship is sent, regardless of which ship happens to be "first".
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ShipDispatchFormProps {
  shipId: string;
  /** Candidate target systems within travel range (already filtered server-side). */
  targetSystems: { id: string; name: string }[];
}

export function ShipDispatchForm({ shipId, targetSystems }: ShipDispatchFormProps) {
  const [destId, setDestId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const router = useRouter();

  async function handleDispatch() {
    if (!destId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationSystemId: destId, shipId }),
      });
      const json = await res.json();
      if (json.ok) {
        setSent(true);
        router.refresh();
      } else {
        setError(json.error?.message ?? "Dispatch failed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <span className="text-xs text-indigo-400">
        Dispatched →{" "}
        {targetSystems.find((s) => s.id === destId)?.name ?? destId}
      </span>
    );
  }

  if (targetSystems.length === 0) {
    return (
      <p className="text-xs text-zinc-700">No reachable systems.</p>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <select
          value={destId}
          onChange={(e) => {
            setDestId(e.target.value);
            setError(null);
          }}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 focus:border-indigo-600 focus:outline-none transition-colors"
        >
          <option value="">Select destination…</option>
          {targetSystems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleDispatch}
          disabled={!destId || loading}
          className="shrink-0 rounded-lg border border-indigo-700 bg-indigo-950/70 px-4 py-2 text-sm font-semibold text-indigo-300 hover:bg-indigo-900/70 hover:border-indigo-600 disabled:opacity-40 transition-colors"
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
