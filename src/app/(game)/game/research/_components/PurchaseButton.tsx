"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PurchaseButtonProps {
  researchId: string;
  costLabel: string;
}

export function PurchaseButton({ researchId, costLabel }: PurchaseButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handlePurchase() {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/game/research/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researchId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErrorMsg(json.error?.message ?? "Purchase failed.");
        setState("error");
        return;
      }
      setState("idle");
      router.refresh();
    } catch {
      setErrorMsg("Network error. Please try again.");
      setState("error");
    }
  }

  return (
    <div className="mt-1.5">
      {errorMsg && (
        <p className="mb-1 text-xs text-red-400">{errorMsg}</p>
      )}
      <button
        onClick={handlePurchase}
        disabled={state === "loading"}
        className="rounded bg-indigo-700 px-2.5 py-1 text-xs font-semibold text-white
                   hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors"
      >
        {state === "loading" ? "Researching…" : `Research · ${costLabel}`}
      </button>
    </div>
  );
}
