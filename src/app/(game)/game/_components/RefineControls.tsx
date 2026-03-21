"use client";

/**
 * Station refining UI (Phase 15).
 * RefineForm — select a refined resource type, enter amount, trigger POST /api/game/refine.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

const REFINABLE = [
  { value: "steel", label: "Steel",  recipe: "1 iron + 1 carbon → 1 steel" },
  { value: "glass", label: "Glass",  recipe: "1 silica → 1 glass" },
  { value: "food",  label: "Food",   recipe: "1 biomass + 1 water → 1 food" },
] as const;

export function RefineForm() {
  const [resourceType, setResourceType] = useState<string>("steel");
  const [amount, setAmount] = useState<string>("10");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  const selectedRecipe = REFINABLE.find((r) => r.value === resourceType);

  async function handleRefine() {
    const n = parseInt(amount, 10);
    if (isNaN(n) || n < 1) {
      setMessage({ ok: false, text: "Enter a valid amount (1 or more)." });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/game/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType, amount: n }),
      });
      const json = await res.json();
      if (json.ok) {
        setMessage({ ok: true, text: `Refined ${json.data.amount} ${resourceType}.` });
        router.refresh();
      } else {
        setMessage({ ok: false, text: json.error?.message ?? "Refining failed." });
      }
    } catch {
      setMessage({ ok: false, text: "Network error." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Output</label>
          <select
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            disabled={loading}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            {REFINABLE.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Amount</label>
          <input
            type="number"
            min="1"
            max="10000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={loading}
            className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
        </div>
        <button
          onClick={handleRefine}
          disabled={loading}
          className="rounded bg-teal-800 px-3 py-1 text-xs font-medium text-teal-100 hover:bg-teal-700 transition-colors disabled:opacity-60"
        >
          {loading ? "Refining…" : "Refine"}
        </button>
      </div>
      {selectedRecipe && (
        <p className="text-xs text-zinc-600">{selectedRecipe.recipe}</p>
      )}
      {message && (
        <p className={`text-xs ${message.ok ? "text-teal-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
