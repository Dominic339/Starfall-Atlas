"use client";

/**
 * Client-side colony and ship actions for the game dashboard.
 *
 * CollectButton  — collect accrued taxes into player credit balance.
 * ExtractButton  — extract accrued resources into colony inventory.
 * UnloadButton   — unload ship cargo into station inventory.
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

// ---------------------------------------------------------------------------
// Revoke permit button (steward only)
// ---------------------------------------------------------------------------

interface RevokePermitButtonProps {
  permitId: string;
  granteeHandle: string;
}

export function RevokePermitButton({ permitId, granteeHandle }: RevokePermitButtonProps) {
  const [state, setState] = useState<"idle" | "confirm" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const router = useRouter();

  async function handleRevoke() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/game/stewardship/revoke-permit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permitId }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Revoke failed.");
        setState("idle");
        return;
      }
      setRevoked(true);
      router.refresh();
    } catch {
      setError("Network error.");
      setState("idle");
    }
  }

  if (revoked) return <span className="text-xs text-zinc-600">Revoked</span>;

  if (state === "confirm") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">Revoke {granteeHandle}'s permit?</span>
        <button
          onClick={handleRevoke}
          className="rounded bg-red-800/60 border border-red-700/40 px-2 py-0.5 text-xs text-red-300 hover:bg-red-700/60 transition-colors"
        >
          Confirm
        </button>
        <button
          onClick={() => setState("idle")}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setState("confirm")}
      disabled={state === "loading"}
      className="rounded border border-red-900/50 px-2 py-0.5 text-xs text-red-600 hover:border-red-700 hover:text-red-400 transition-colors disabled:opacity-50"
    >
      Revoke
    </button>
  );
}


interface UnloadButtonProps {
  shipId: string;
  /** Pre-formatted cargo summary, e.g. "5 iron, 3 carbon" */
  summary: string;
}

export function UnloadButton({ shipId, summary }: UnloadButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const router = useRouter();

  async function handleUnload() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/game/ship/unload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipId }),
      });

      const json = await res.json();

      if (!json.ok) {
        setError(json.error?.message ?? "Unload failed.");
        return;
      }

      const unloaded = json.data.unloaded as {
        resource_type: string;
        quantity: number;
      }[];
      const text =
        unloaded.length > 0
          ? unloaded.map((u) => `${u.quantity} ${u.resource_type}`).join(", ")
          : "nothing to unload";

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
      <span className="text-xs font-medium text-indigo-400">
        Unloaded: {resultText}
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleUnload}
        disabled={loading}
        className="rounded bg-indigo-700 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Unloading…" : `Unload to Station (${summary})`}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
