"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UpgradeButtonProps {
  shipId: string;
  stat: string;
  ironCost: number;
}

export function UpgradeButton({ shipId, stat, ironCost }: UpgradeButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleUpgrade() {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/game/ship/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipId, stat }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErrorMsg(json.error?.message ?? "Upgrade failed.");
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
        onClick={handleUpgrade}
        disabled={state === "loading"}
        title={`Upgrade ${stat} · ${ironCost} iron`}
        className="rounded bg-indigo-800/80 px-1.5 py-0.5 text-xs font-medium text-indigo-200
                   hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed
                   transition-colors whitespace-nowrap"
      >
        {state === "loading" ? "…" : `↑ ${ironCost} ⛏`}
      </button>
    </span>
  );
}
