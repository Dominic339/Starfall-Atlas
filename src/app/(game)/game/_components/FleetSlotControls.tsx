"use client";

/**
 * Client components for fleet slot controls.
 *
 * FleetSlotModeSelector — changes a slot's mode (manual / auto_collect_nearest / auto_collect_highest).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

const SLOT_MODE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "auto_collect_nearest", label: "Auto: Nearest" },
  { value: "auto_collect_highest", label: "Auto: Highest yield" },
] as const;

interface FleetSlotModeSelectorProps {
  slotId: string;
  currentMode: string;
}

export function FleetSlotModeSelector({ slotId, currentMode }: FleetSlotModeSelectorProps) {
  const [mode, setMode] = useState(currentMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleChange(newMode: string) {
    if (newMode === mode || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/fleet-slot/set-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, mode: newMode }),
      });
      const json = await res.json();
      if (json.ok) {
        setMode(newMode);
        router.refresh();
      } else {
        setError(json.error?.message ?? "Failed to change mode.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-0.5">
      <select
        value={mode}
        onChange={(e) => handleChange(e.target.value)}
        disabled={loading}
        className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300
                   border border-zinc-700 focus:outline-none focus:border-zinc-500
                   disabled:opacity-50 cursor-pointer"
      >
        {SLOT_MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {loading ? "…" : opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
