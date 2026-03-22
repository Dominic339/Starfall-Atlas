"use client";

/**
 * DevControls — dev-only panel rendered on the Command Centre page.
 * Provides shortcuts for manual testing without waiting for real-time travel.
 *
 * Only rendered when NODE_ENV !== 'production' (enforced by the parent
 * server component). The matching API route also guards itself.
 */

import { useState } from "react";

export function DevControls({ pendingTravelCount }: { pendingTravelCount: number }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function completeTravelNow() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/dev/travel/complete", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        const { completed, loaded, unloaded } = json.data;
        const parts: string[] = [`${completed} trip${completed !== 1 ? "s" : ""} completed`];
        if (loaded > 0) parts.push(`${loaded} loaded`);
        if (unloaded > 0) parts.push(`${unloaded} unloaded to station`);
        setMessage(parts.join(" · ") + ". Refresh to see updated state.");
      } else {
        setMessage(`Error: ${json.error?.message ?? "Unknown error"}`);
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-yellow-800/60 bg-yellow-950/20 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-yellow-500">Dev Controls</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={completeTravelNow}
          disabled={loading || pendingTravelCount === 0}
          className="rounded border border-yellow-700/60 bg-yellow-900/30 px-3 py-1.5 text-xs font-medium text-yellow-300 hover:bg-yellow-800/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Completing…" : `Complete Travel Now (${pendingTravelCount} pending)`}
        </button>
        {message && (
          <span className="text-xs text-yellow-400">{message}</span>
        )}
      </div>
    </div>
  );
}
