"use client";

/**
 * Colony supply route UI (Phase 15).
 * CreateRouteForm — form to create a new supply route from a colony.
 * DeleteRouteButton — deletes an existing route.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DestColony {
  id: string;
  label: string; // e.g. "Alpha Centauri · Body 2"
}

interface CreateRouteFormProps {
  fromColonyId: string;
  destColonies: DestColony[];
  resourceTypes: string[];
}

export function CreateRouteForm({ fromColonyId, destColonies, resourceTypes }: CreateRouteFormProps) {
  const [toColonyId, setToColonyId]         = useState(destColonies[0]?.id ?? "");
  const [resourceType, setResourceType]     = useState(resourceTypes[0] ?? "iron");
  const [mode, setMode]                     = useState<"all" | "excess" | "fixed">("all");
  const [fixedAmount, setFixedAmount]       = useState("50");
  const [intervalMinutes, setIntervalMins]  = useState("60");
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [expanded, setExpanded]             = useState(false);
  const router = useRouter();

  if (destColonies.length === 0) {
    return (
      <p className="text-xs text-zinc-700">
        No other active colonies to route to.
      </p>
    );
  }

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/colony/route/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromColonyId,
          toColonyId,
          resourceType,
          mode,
          fixedAmount: mode === "fixed" ? parseInt(fixedAmount, 10) : undefined,
          intervalMinutes: parseInt(intervalMinutes, 10),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setExpanded(false);
        router.refresh();
      } else {
        setError(json.error?.message ?? "Failed to create route.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="rounded border border-dashed border-zinc-700 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-400 transition-colors"
      >
        + Create Route
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded border border-zinc-700 bg-zinc-900 p-3">
      <p className="text-xs font-medium text-zinc-400">New Supply Route</p>
      <div className="grid grid-cols-2 gap-2">
        {/* Destination */}
        <div className="space-y-0.5">
          <label className="text-xs text-zinc-600">To colony</label>
          <select
            value={toColonyId}
            onChange={(e) => setToColonyId(e.target.value)}
            disabled={loading}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
          >
            {destColonies.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Resource */}
        <div className="space-y-0.5">
          <label className="text-xs text-zinc-600">Resource</label>
          <select
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            disabled={loading}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
          >
            {resourceTypes.map((rt) => (
              <option key={rt} value={rt}>{rt}</option>
            ))}
          </select>
        </div>

        {/* Mode */}
        <div className="space-y-0.5">
          <label className="text-xs text-zinc-600">Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "all" | "excess" | "fixed")}
            disabled={loading}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
          >
            <option value="all">All — send everything</option>
            <option value="excess">Excess — keep 100, send rest</option>
            <option value="fixed">Fixed amount per interval</option>
          </select>
        </div>

        {/* Interval */}
        <div className="space-y-0.5">
          <label className="text-xs text-zinc-600">Every (min)</label>
          <input
            type="number"
            min="30"
            value={intervalMinutes}
            onChange={(e) => setIntervalMins(e.target.value)}
            disabled={loading}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
          />
        </div>

        {/* Fixed amount (conditional) */}
        {mode === "fixed" && (
          <div className="space-y-0.5 col-span-2">
            <label className="text-xs text-zinc-600">Fixed amount per interval</label>
            <input
              type="number"
              min="1"
              value={fixedAmount}
              onChange={(e) => setFixedAmount(e.target.value)}
              disabled={loading}
              className="w-32 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
            />
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={loading}
          className="rounded bg-indigo-800 px-3 py-1 text-xs font-medium text-indigo-100 hover:bg-indigo-700 transition-colors disabled:opacity-60"
        >
          {loading ? "Creating…" : "Create Route"}
        </button>
        <button
          onClick={() => { setExpanded(false); setError(null); }}
          disabled={loading}
          className="rounded px-3 py-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DeleteRouteButton({ routeId }: { routeId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);
    try {
      const res = await fetch("/api/game/colony/route/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId }),
      });
      const json = await res.json();
      if (json.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="text-xs text-zinc-700 hover:text-red-400 transition-colors disabled:opacity-60"
      title="Delete route"
    >
      {loading ? "…" : "✕"}
    </button>
  );
}
