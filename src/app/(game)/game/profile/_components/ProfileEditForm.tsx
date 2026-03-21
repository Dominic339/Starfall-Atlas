"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  currentHandle: string;
  currentTitle: string;
  currentBio: string;
}

export function ProfileEditForm({ currentHandle, currentTitle, currentBio }: Props) {
  const router = useRouter();
  const [handle, setHandle] = useState(currentHandle);
  const [title,  setTitle]  = useState(currentTitle);
  const [bio,    setBio]    = useState(currentBio);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/game/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: handle.trim() || undefined,
          title:  title.trim()  || null,
          bio:    bio.trim()    || null,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSuccess(true);
        router.refresh();
      } else {
        setError(json.error?.message ?? "Failed to update profile.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs text-zinc-500 mb-1" htmlFor="handle">
          Handle <span className="text-zinc-700">(3–32 chars, letters/digits/underscores)</span>
        </label>
        <input
          id="handle"
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9_]+"
          required
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1" htmlFor="title">
          Title <span className="text-zinc-700">(max 64 chars, optional)</span>
        </label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={64}
          placeholder="e.g. Pioneer, Explorer, Grand Admiral"
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none placeholder:text-zinc-700"
        />
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1" htmlFor="bio">
          Bio <span className="text-zinc-700">(max 512 chars, optional)</span>
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={512}
          rows={4}
          placeholder="Tell other pilots about yourself…"
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none placeholder:text-zinc-700 resize-none"
        />
        <p className="mt-0.5 text-right text-xs text-zinc-700">{bio.length}/512</p>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
      {success && (
        <p className="text-xs text-emerald-400">Profile updated.</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
      >
        {loading ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
