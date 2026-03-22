"use client";

/**
 * Client-side actions for the system detail page.
 *
 * Handles:
 *   - Travel: POST /api/game/travel
 *   - Discover: POST /api/game/discover
 *   - Travel resolve: POST /api/game/travel/resolve (for in-transit state)
 *   - Survey: POST /api/game/survey
 *   - Found colony: POST /api/game/colony/found
 *   - Load cargo: POST /api/game/ship/load
 *
 * Each action refreshes the page after completion so the server component
 * re-fetches and shows updated state.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Travel button
// ---------------------------------------------------------------------------

interface TravelButtonProps {
  destinationSystemId: string;
  destinationName: string;
  distanceLy: number;
  travelHours: number;
  shipName?: string;
}

export function TravelButton({
  destinationSystemId,
  destinationName,
  distanceLy,
  travelHours,
  shipName,
}: TravelButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const eta =
    travelHours < 1
      ? `${Math.round(travelHours * 60)} min`
      : `${travelHours.toFixed(1)} hr`;

  async function handleConfirmedTravel() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/game/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationSystemId }),
      });

      const json = await res.json();

      if (!json.ok) {
        setError(json.error?.message ?? "Travel failed.");
        setConfirming(false);
        return;
      }

      // Navigate back to dashboard to see in-transit status.
      router.push("/game");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className="space-y-2 rounded-lg border border-indigo-800/60 bg-indigo-950/30 px-4 py-3">
        <p className="text-sm font-medium text-zinc-200">Confirm departure</p>
        <div className="text-xs text-zinc-400 space-y-0.5">
          <p>Destination: <span className="text-zinc-200">{destinationName}</span></p>
          <p>Distance: <span className="text-zinc-200">{distanceLy.toFixed(2)} ly</span></p>
          <p>ETA: <span className="text-zinc-200">{eta}</span></p>
          {shipName && <p>Ship: <span className="text-zinc-200">{shipName}</span></p>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleConfirmedTravel}
            disabled={loading}
            className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Departing…" : "Confirm Departure"}
          </button>
          <button
            onClick={() => { setConfirming(false); setError(null); }}
            disabled={loading}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setConfirming(true)}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
      >
        Travel to {destinationName} · {distanceLy.toFixed(2)} ly · ETA {eta}
      </button>
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discover button
// ---------------------------------------------------------------------------

interface DiscoverButtonProps {
  systemId: string;
  systemName: string;
}

export function DiscoverButton({ systemId, systemName }: DiscoverButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDiscover() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/game/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemId }),
      });

      const json = await res.json();

      if (!json.ok) {
        setError(json.error?.message ?? "Discovery failed.");
        return;
      }

      // Refresh page to show updated discovery/stewardship state.
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleDiscover}
        disabled={loading}
        className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Registering discovery…" : `Discover ${systemName}`}
      </button>
      <p className="text-xs text-zinc-600">
        First discoverer automatically becomes steward.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Survey button (shown per-body when ship is present and body unsurveyed)
// ---------------------------------------------------------------------------

interface SurveyButtonProps {
  bodyId: string;
  bodyLabel: string;
}

export function SurveyButton({ bodyId, bodyLabel }: SurveyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function handleSurvey() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/game/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyId }),
      });

      const json = await res.json();

      if (!json.ok) {
        setError(json.error?.message ?? "Survey failed.");
        return;
      }

      setDone(true);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <p className="text-xs text-teal-400">Survey complete — refreshing…</p>;
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleSurvey}
        disabled={loading}
        className="rounded bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Surveying…" : `Survey ${bodyLabel} with Ship`}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Found colony button (shown per-body when eligible and conditions met)
// ---------------------------------------------------------------------------

interface FoundColonyButtonProps {
  bodyId: string;
  bodyLabel: string;
  isFirstColony: boolean;
}

export function FoundColonyButton({
  bodyId,
  bodyLabel,
  isFirstColony,
}: FoundColonyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function handleFound() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/game/colony/found", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyId }),
      });

      const json = await res.json();

      if (!json.ok) {
        setError(json.error?.message ?? "Colony founding failed.");
        return;
      }

      setDone(true);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <p className="text-xs text-emerald-400">Colony founded — refreshing…</p>;
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleFound}
        disabled={loading}
        className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Founding…" : `Found Colony on ${bodyLabel}`}
      </button>
      {isFirstColony && (
        <p className="text-xs text-zinc-500">Your first colony is free.</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arrival countdown + resolve button (shown on system page if in transit here)
// ---------------------------------------------------------------------------

interface ArriveButtonProps {
  jobId: string;
  arriveAt: string; // ISO string
  systemName: string;
}

export function ArriveButton({ jobId, arriveAt, systemName }: ArriveButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canArrive, setCanArrive] = useState(
    new Date() >= new Date(arriveAt),
  );
  const router = useRouter();

  useEffect(() => {
    if (canArrive) return;

    const interval = setInterval(() => {
      if (new Date() >= new Date(arriveAt)) {
        setCanArrive(true);
        clearInterval(interval);
      }
    }, 5_000); // poll every 5 seconds

    return () => clearInterval(interval);
  }, [arriveAt, canArrive]);

  async function handleArrive() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/game/travel/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });

      const json = await res.json();

      if (!json.ok) {
        setError(json.error?.message ?? "Arrival failed.");
        return;
      }

      router.push(`/game/system/${encodeURIComponent(json.data.ship.current_system_id)}`);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const eta = new Date(arriveAt);
  const remainingMs = Math.max(0, eta.getTime() - Date.now());
  const remainingMin = Math.ceil(remainingMs / 60_000);

  return (
    <div className="space-y-2">
      {!canArrive && (
        <p className="text-sm text-zinc-400">
          Arriving in{" "}
          <span className="font-mono text-indigo-300">
            ~{remainingMin} min
          </span>
          {" "}at {systemName}.
        </p>
      )}
      <button
        onClick={handleArrive}
        disabled={!canArrive || loading}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Arriving…" : canArrive ? `Arrive at ${systemName}` : "Awaiting arrival…"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Load cargo button (shown per resource type in colony inventory when ship present)
// ---------------------------------------------------------------------------

interface LoadButtonProps {
  shipId: string;
  colonyId: string;
  resourceType: string;
  available: number;
}

export function LoadButton({
  shipId,
  colonyId,
  resourceType,
  available,
}: LoadButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<number | null>(null);
  const router = useRouter();

  async function handleLoad() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/game/ship/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipId,
          colonyId,
          resourceType,
          quantity: available,
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        setError(json.error?.message ?? "Load failed.");
        return;
      }

      setLoaded(json.data.loaded as number);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (loaded !== null) {
    return (
      <span className="text-xs font-medium text-indigo-400">
        +{loaded} loaded
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleLoad}
        disabled={loading}
        className="rounded bg-indigo-700 px-2 py-0.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Loading…" : `Load all`}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
