"use client";

/**
 * ShipModeButton — sets a ship's dispatch mode (manual / auto-collect).
 *
 * Calls POST /api/game/ship/mode and refreshes the page on success.
 *
 * Props:
 *   shipId       UUID of the ship to update
 *   currentMode  The ship's current dispatch_mode value
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

type DispatchMode = "manual" | "auto_collect_nearest" | "auto_collect_highest";

const MODE_LABELS: Record<DispatchMode, string> = {
  manual: "Manual",
  auto_collect_nearest: "Auto: Nearest",
  auto_collect_highest: "Auto: Highest yield",
};

interface ShipModeButtonProps {
  shipId: string;
  currentMode: DispatchMode;
}

export function ShipModeButton({ shipId, currentMode }: ShipModeButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function setMode(mode: DispatchMode) {
    if (mode === currentMode) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/ship/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipId, mode }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Failed to set mode.");
        return;
      }
      // When activating an auto mode, immediately advance the state machine so
      // the ship dispatches to a colony on this page refresh rather than sitting
      // idle until the player visits the map.
      if (mode !== "manual") {
        await fetch("/api/engine/resolve-travel", { method: "POST" }).catch(() => null);
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const modes: DispatchMode[] = ["manual", "auto_collect_nearest", "auto_collect_highest"];

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {modes.map((mode) => (
          <button
            key={mode}
            onClick={() => setMode(mode)}
            disabled={loading}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === currentMode
                ? mode === "manual"
                  ? "bg-zinc-700 text-zinc-200"
                  : "bg-teal-800/70 text-teal-300 border border-teal-700/50"
                : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            }`}
          >
            {loading && mode !== currentMode ? "…" : MODE_LABELS[mode]}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
