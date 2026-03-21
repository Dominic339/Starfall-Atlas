"use client";

import { useState } from "react";

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

export function DeleteAccountForm() {
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [done,    setDone]    = useState(false);

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/game/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      const json = await res.json();
      if (json.ok) {
        setDone(true);
        // Give a moment to read the message, then redirect to login
        setTimeout(() => {
          window.location.href = "/login";
        }, 2500);
      } else {
        setError(json.error?.message ?? "Failed to delete account.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-emerald-400">
        Account deactivated. Redirecting…
      </p>
    );
  }

  return (
    <form onSubmit={handleDelete} className="space-y-3">
      <p className="text-xs text-zinc-500">
        Type{" "}
        <span className="font-mono text-zinc-300">{CONFIRM_PHRASE}</span>{" "}
        to confirm.
      </p>
      <input
        type="text"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={CONFIRM_PHRASE}
        className="w-full rounded-md border border-red-900/60 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-red-600 focus:outline-none placeholder:text-zinc-700"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading || confirm !== CONFIRM_PHRASE}
        className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40 transition-colors"
      >
        {loading ? "Deleting…" : "Delete my account"}
      </button>
    </form>
  );
}
