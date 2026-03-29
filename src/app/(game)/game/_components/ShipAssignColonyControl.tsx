"use client";

/**
 * ShipAssignColonyControl — lets the player pin a ship to a specific colony.
 *
 * Renders a compact <select> listing the player's active colonies.
 * On change, POSTs to /api/game/ship/assign-colony and refreshes.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Colony {
  id: string;
  label: string; // pre-formatted: "Sol · Body 3 (T2)"
}

interface ShipAssignColonyControlProps {
  shipId: string;
  currentPinnedColonyId: string | null;
  colonies: Colony[];
}

export function ShipAssignColonyControl({
  shipId,
  currentPinnedColonyId,
  colonies,
}: ShipAssignColonyControlProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleChange(colonyId: string | null) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/ship/assign-colony", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipId, colonyId }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Failed to update assignment.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <select
        value={currentPinnedColonyId ?? ""}
        disabled={loading || colonies.length === 0}
        onChange={(e) => handleChange(e.target.value || null)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 focus:border-indigo-600 focus:outline-none disabled:opacity-50 transition-colors"
      >
        <option value="">— No assignment (auto-select)</option>
        {colonies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {colonies.length === 0 && (
        <p className="text-xs text-zinc-700">No active colonies to assign.</p>
      )}
    </div>
  );
}
