"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PurchaseButtonProps {
  researchId: string;
  costLabel: string;
  /** When true, button renders in a disabled/locked visual state. */
  disabled?: boolean;
  /** Shown as button text and title tooltip when disabled. */
  disabledReason?: string;
}

export function PurchaseButton({
  researchId,
  costLabel,
  disabled = false,
  disabledReason,
}: PurchaseButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handlePurchase() {
    if (disabled) return;
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

  const isDisabled = disabled || state === "loading";

  const label =
    state === "loading"
      ? "Researching…"
      : disabled
      ? (disabledReason ?? `Need ${costLabel}`)
      : `Research  →`;

  return (
    <div className="mt-1.5">
      {errorMsg && (
        <p className="mb-1 text-xs text-red-400">{errorMsg}</p>
      )}
      <button
        onClick={handlePurchase}
        disabled={isDisabled}
        title={disabled ? (disabledReason ?? `Need ${costLabel}`) : undefined}
        className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
          disabled
            ? "bg-zinc-700/60 text-zinc-500 cursor-not-allowed"
            : state === "loading"
            ? "bg-indigo-800 text-indigo-300 cursor-wait opacity-75"
            : "bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white"
        }`}
      >
        {label}
      </button>
    </div>
  );
}
