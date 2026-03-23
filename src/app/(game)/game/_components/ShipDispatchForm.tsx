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
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <select
          value={destId}
          onChange={(e) => {
            setDestId(e.target.value);
            setError(null);
          }}
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
        >
          <option value="">Dispatch to…</option>
          {targetSystems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleDispatch}
          disabled={!destId || loading}
          className="rounded border border-indigo-700 bg-indigo-950/60 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-900/60 disabled:opacity-40 transition-colors"
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
