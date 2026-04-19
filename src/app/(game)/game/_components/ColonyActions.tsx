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


// ---------------------------------------------------------------------------
// Emergency Universal Exchange buy button
// ---------------------------------------------------------------------------

interface EuxResourceOption {
  resourceType: "iron" | "carbon" | "ice";
  pricePerUnit: number;
}

interface EuxBuyButtonProps {
  colonyId: string;
  options: EuxResourceOption[];
  dailyUsed: number;
  dailyLimit: number;
  playerCredits: number;
}

export function EuxBuyButton({
  colonyId,
  options,
  dailyUsed,
  dailyLimit,
  playerCredits,
}: EuxBuyButtonProps) {
  const [resourceType, setResourceType] = useState<"iron" | "carbon" | "ice">(
    options[0]?.resourceType ?? "iron",
  );
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ qty: number; cost: number } | null>(null);
  const router = useRouter();

  const selected = options.find((o) => o.resourceType === resourceType);
  const pricePerUnit = selected?.pricePerUnit ?? 0;
  const totalCost = qty * pricePerUnit;
  const remaining = dailyLimit - dailyUsed;
  const canBuy = playerCredits >= totalCost && remaining >= qty;

  if (result) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-emerald-400">
          Delivered {result.qty} {resourceType} (−{result.cost} ¢)
        </span>
        <button
          onClick={() => setResult(null)}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Buy more
        </button>
      </div>
    );
  }

  async function handleBuy() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/eux/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId, resourceType, quantity: qty }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Purchase failed.");
      } else {
        setResult({ qty, cost: json.data.creditsSpent });
        router.refresh();
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value as "iron" | "carbon" | "ice")}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 focus:border-orange-600 focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.resourceType} value={o.resourceType}>
              {o.resourceType} ({o.pricePerUnit} ¢/u)
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={Math.min(remaining, 500)}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.min(remaining, Number(e.target.value) || 1)))}
          className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-center text-xs text-zinc-200 focus:border-orange-600 focus:outline-none"
        />
        <button
          onClick={handleBuy}
          disabled={loading || !canBuy}
          title={!canBuy ? (remaining < qty ? "Daily limit reached" : `Need ${totalCost} ¢`) : undefined}
          className="rounded border border-orange-800/60 bg-orange-950/40 px-3 py-1 text-xs font-medium text-orange-300 hover:bg-orange-900/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {loading ? "Buying…" : `Buy (${totalCost.toLocaleString()} ¢)`}
        </button>
      </div>
      <p className="text-xs text-zinc-700">
        Daily limit: {dailyUsed}/{dailyLimit} used
        {remaining === 0 && <span className="ml-1 text-orange-600">· limit reached</span>}
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
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

// ---------------------------------------------------------------------------
// Reactivate abandoned colony button
// ---------------------------------------------------------------------------

export function ReactivateButton({ colonyId }: { colonyId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const router = useRouter();

  async function handleReactivate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/colony/reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colonyId }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Reactivation failed.");
      } else {
        setDone(true);
        router.refresh();
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  if (done) return <p className="text-xs text-emerald-500">Colony reactivated!</p>;

  return (
    <div className="space-y-1">
      <button
        onClick={handleReactivate}
        disabled={loading}
        className="rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
      >
        {loading ? "Reactivating…" : "Reactivate Colony"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
