"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────────
// CreateFleetForm
// ─────────────────────────────────────────────────────────────────────────────

interface DockedShipOption {
  id: string;
  name: string;
}

interface CreateFleetFormProps {
  dockedShips: DockedShipOption[];
}

export function CreateFleetForm({ dockedShips }: CreateFleetFormProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function toggleShip(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    if (selected.size < 2) {
      setErrorMsg("Select at least 2 ships to form a fleet.");
      return;
    }
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/game/fleet/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipIds: [...selected] }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErrorMsg(json.error?.message ?? "Failed to create fleet.");
        setState("error");
        return;
      }
      setSelected(new Set());
      setState("idle");
      router.refresh();
    } catch {
      setErrorMsg("Network error.");
      setState("error");
    }
  }

  if (dockedShips.length < 2) return null;

  return (
    <div className="rounded border border-indigo-700/40 bg-indigo-950/30 p-3 text-sm">
      <p className="mb-2 font-medium text-indigo-300">Form Fleet</p>
      <div className="mb-2 flex flex-wrap gap-2">
        {dockedShips.map((s) => (
          <label
            key={s.id}
            className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs
              ${selected.has(s.id)
                ? "bg-indigo-700 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={selected.has(s.id)}
              onChange={() => toggleShip(s.id)}
            />
            {s.name}
          </label>
        ))}
      </div>
      {errorMsg && (
        <p className="mb-1 text-xs text-red-400">{errorMsg}</p>
      )}
      <button
        onClick={handleCreate}
        disabled={state === "loading" || selected.size < 2}
        className="rounded bg-indigo-700 px-3 py-1 text-xs font-medium text-white
                   hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed
                   transition-colors"
      >
        {state === "loading" ? "Forming…" : `Form Fleet (${selected.size})`}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DispatchFleetForm
// ─────────────────────────────────────────────────────────────────────────────

interface NearbySystem {
  id: string;
  name: string;
}

interface DispatchFleetFormProps {
  fleetId: string;
  nearbySystems: NearbySystem[];
}

export function DispatchFleetForm({ fleetId, nearbySystems }: DispatchFleetFormProps) {
  const router = useRouter();
  const [destinationId, setDestinationId] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleDispatch() {
    if (!destinationId) {
      setErrorMsg("Select a destination.");
      return;
    }
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/game/fleet/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fleetId, destinationSystemId: destinationId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErrorMsg(json.error?.message ?? "Dispatch failed.");
        setState("error");
        return;
      }
      setState("idle");
      setDestinationId("");
      router.refresh();
    } catch {
      setErrorMsg("Network error.");
      setState("error");
    }
  }

  if (nearbySystems.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <select
          value={destinationId}
          onChange={(e) => setDestinationId(e.target.value)}
          disabled={state === "loading"}
          className="flex-1 rounded bg-slate-800 px-2 py-1 text-xs text-slate-200
                     border border-slate-600 focus:outline-none focus:border-indigo-500
                     disabled:opacity-40"
        >
          <option value="">Select destination…</option>
          {nearbySystems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleDispatch}
          disabled={state === "loading" || !destinationId}
          className="rounded bg-indigo-700 px-3 py-1 text-xs font-medium text-white
                     hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors whitespace-nowrap"
        >
          {state === "loading" ? "Dispatching…" : "Dispatch →"}
        </button>
      </div>
      {errorMsg && (
        <p className="text-xs text-red-400">{errorMsg}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DisbandFleetButton
// ─────────────────────────────────────────────────────────────────────────────

interface DisbandFleetButtonProps {
  fleetId: string;
}

export function DisbandFleetButton({ fleetId }: DisbandFleetButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleDisband() {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/game/fleet/disband", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fleetId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErrorMsg(json.error?.message ?? "Disband failed.");
        setState("error");
        return;
      }
      setState("idle");
      router.refresh();
    } catch {
      setErrorMsg("Network error.");
      setState("error");
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      {errorMsg && (
        <span className="text-xs text-red-400 max-w-[160px] text-right leading-tight">
          {errorMsg}
        </span>
      )}
      <button
        onClick={handleDisband}
        disabled={state === "loading"}
        className="rounded bg-red-900/60 px-2 py-0.5 text-xs font-medium text-red-300
                   hover:bg-red-800/80 disabled:opacity-40 disabled:cursor-not-allowed
                   transition-colors whitespace-nowrap"
      >
        {state === "loading" ? "Disbanding…" : "Disband"}
      </button>
    </span>
  );
}
