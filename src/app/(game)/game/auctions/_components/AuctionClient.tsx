"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Shared types (passed from server)
// ---------------------------------------------------------------------------

export interface AuctionDisplay {
  id: string;
  itemType: "colony" | "stewardship";
  itemId: string;
  itemLabel: string;
  minBid: number;
  currentHighBid: number;
  highBidderId: string | null;
  sellerId: string;
  sellerHandle: string;
  endsAt: string;
}

export interface EligibleItem {
  id: string;
  type: "colony" | "stewardship";
  label: string;
}

interface AuctionClientProps {
  auctions: AuctionDisplay[];
  eligibleItems: EligibleItem[];
  playerCredits: number;
  playerId: string;
  minDurationHours: number;
  maxDurationDays: number;
  defaultDurationHours: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeLeft(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const days  = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins  = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function timeLeftColor(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "text-zinc-600";
  if (ms < 2 * 3_600_000)  return "text-red-400";
  if (ms < 12 * 3_600_000) return "text-amber-400";
  return "text-emerald-400";
}

// ---------------------------------------------------------------------------
// Bid form (per auction)
// ---------------------------------------------------------------------------

function BidForm({
  auction,
  playerCredits,
}: {
  auction: AuctionDisplay;
  playerCredits: number;
}) {
  const minBid = Math.max(auction.minBid, auction.currentHighBid + 1);
  const [amount, setAmount] = useState(minBid);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ amount: number; extended: boolean } | null>(null);
  const router = useRouter();

  if (result) {
    return (
      <div className="space-y-0.5">
        <p className="text-xs text-emerald-400">
          Bid placed: {result.amount.toLocaleString()} ¢
          {result.extended && <span className="ml-1 text-amber-400">· auction extended</span>}
        </p>
      </div>
    );
  }

  async function handleBid() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/auction/bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId: auction.id, amount }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Bid failed.");
      } else {
        setResult({ amount, extended: json.data.extended });
        router.refresh();
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const canBid = playerCredits >= amount && amount >= minBid;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="number"
        min={minBid}
        value={amount}
        onChange={(e) => setAmount(Math.max(minBid, Number(e.target.value) || minBid))}
        className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-center text-xs text-zinc-200 focus:border-indigo-600 focus:outline-none"
      />
      <span className="text-xs text-zinc-600">¢</span>
      <button
        onClick={handleBid}
        disabled={loading || !canBid}
        title={!canBid ? `Need ${amount} ¢` : undefined}
        className="rounded border border-indigo-700/60 bg-indigo-950/40 px-3 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-900/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {loading ? "Bidding…" : "Place Bid"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cancel button (seller, no bids)
// ---------------------------------------------------------------------------

function CancelAuctionButton({ auctionId }: { auctionId: string }) {
  const [state, setState] = useState<"idle" | "confirm" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/game/auction/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Cancel failed.");
        setState("idle");
      } else {
        setDone(true);
        router.refresh();
      }
    } catch {
      setError("Network error.");
      setState("idle");
    }
  }

  if (done) return <span className="text-xs text-zinc-600">Cancelled</span>;

  if (state === "confirm") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">Cancel this auction?</span>
        <button
          onClick={handleCancel}
          className="rounded bg-red-800/60 border border-red-700/40 px-2 py-0.5 text-xs text-red-300 hover:bg-red-700/60 transition-colors"
        >
          Confirm
        </button>
        <button
          onClick={() => setState("idle")}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Keep
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setState("confirm")}
      disabled={state === "loading"}
      className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-500 hover:border-red-800 hover:text-red-500 transition-colors disabled:opacity-50"
    >
      Cancel Auction
    </button>
  );
}

// ---------------------------------------------------------------------------
// Create auction form
// ---------------------------------------------------------------------------

function CreateAuctionForm({
  eligibleItems,
  playerCredits,
  minDurationHours,
  maxDurationDays,
  defaultDurationHours,
}: {
  eligibleItems: EligibleItem[];
  playerCredits: number;
  minDurationHours: number;
  maxDurationDays: number;
  defaultDurationHours: number;
}) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState(eligibleItems[0]?.id ?? "");
  const [minBid, setMinBid] = useState(0);
  const [durationHours, setDurationHours] = useState(defaultDurationHours);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  const maxH = maxDurationDays * 24;
  const durationOptions = [1, 6, 12, 24, 48, 72, 168].filter(
    (h) => h >= minDurationHours && h <= maxH,
  );

  if (eligibleItems.length === 0) return null;

  async function handleCreate() {
    setLoading(true);
    setError(null);
    const selected = eligibleItems.find((i) => i.id === itemId);
    if (!selected) return;
    try {
      const res = await fetch("/api/game/auction/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType: selected.type,
          itemId,
          minBid,
          durationHours,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Failed to create auction.");
      } else {
        setDone(`Auction created — ends ${new Date(json.data.endsAt).toLocaleString()}`);
        router.refresh();
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-4 py-3">
        <p className="text-sm text-emerald-400">{done}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 animate-fade-in-up">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
      >
        <span>{open ? "▾" : "▸"}</span>
        Create Auction
        <span className="text-xs text-zinc-600 font-normal">
          ({eligibleItems.length} item{eligibleItems.length !== 1 ? "s" : ""} eligible)
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-600">Item</label>
              <select
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 focus:border-indigo-600 focus:outline-none"
              >
                {eligibleItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.type === "stewardship" ? "⬡ " : "◉ "}
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-600">Min bid (¢)</label>
              <input
                type="number"
                min={0}
                value={minBid}
                onChange={(e) => setMinBid(Math.max(0, Number(e.target.value) || 0))}
                className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-center text-xs text-zinc-200 focus:border-indigo-600 focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-600">Duration</label>
              <select
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value))}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 focus:border-indigo-600 focus:outline-none"
              >
                {durationOptions.map((h) => (
                  <option key={h} value={h}>
                    {h < 24 ? `${h}h` : `${h / 24}d`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-600 opacity-0">Go</label>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="rounded border border-indigo-700/60 bg-indigo-950/40 px-4 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-900/50 disabled:opacity-50 transition-colors"
              >
                {loading ? "Creating…" : "Start Auction"}
              </button>
            </div>
          </div>

          <p className="text-xs text-zinc-700">
            Your balance: {playerCredits.toLocaleString()} ¢ · No listing fee for auctions
          </p>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auction card
// ---------------------------------------------------------------------------

function AuctionCard({
  auction,
  playerId,
  playerCredits,
}: {
  auction: AuctionDisplay;
  playerId: string;
  playerCredits: number;
}) {
  const isSeller     = auction.sellerId === playerId;
  const isHighBidder = auction.highBidderId === playerId;
  const hasBids      = auction.currentHighBid > 0;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 space-y-2 card-interactive animate-fade-in-up">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs rounded px-1.5 py-0.5 border border-zinc-700 text-zinc-500 uppercase tracking-wide">
              {auction.itemType === "stewardship" ? "stewardship" : "colony"}
            </span>
            <span className="text-sm font-medium text-zinc-200">{auction.itemLabel}</span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-600">
            Seller: @{auction.sellerHandle}
            {isSeller && <span className="ml-1 text-zinc-500">(you)</span>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-zinc-600">Ends in</p>
          <p className={`text-sm font-mono tabular-nums ${timeLeftColor(auction.endsAt)}`}>{formatTimeLeft(auction.endsAt)}</p>
        </div>
      </div>

      {/* Bid status */}
      <div className="flex items-center gap-3 flex-wrap">
        {hasBids ? (
          <div>
            <span className="text-xs text-zinc-600">Current bid: </span>
            <span className="text-sm font-semibold text-emerald-400">
              {auction.currentHighBid.toLocaleString()} ¢
            </span>
            {isHighBidder && (
              <span className="ml-2 text-xs text-emerald-600">Your bid is leading</span>
            )}
          </div>
        ) : (
          <div>
            <span className="text-xs text-zinc-600">No bids · Min: </span>
            <span className="text-sm font-semibold text-zinc-400">
              {auction.minBid.toLocaleString()} ¢
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      {isSeller && !hasBids && <CancelAuctionButton auctionId={auction.id} />}
      {isSeller && hasBids && (
        <p className="text-xs text-zinc-700">Auction in progress — cannot cancel with bids</p>
      )}
      {!isSeller && !isHighBidder && (
        <BidForm auction={auction} playerCredits={playerCredits} />
      )}
      {!isSeller && isHighBidder && (
        <p className="text-xs text-zinc-600">You are the current high bidder.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function AuctionClient({
  auctions,
  eligibleItems,
  playerCredits,
  playerId,
  minDurationHours,
  maxDurationDays,
  defaultDurationHours,
}: AuctionClientProps) {
  const myAuctions  = auctions.filter((a) => a.sellerId === playerId);
  const otherAuctions = auctions.filter((a) => a.sellerId !== playerId);

  return (
    <div className="space-y-6">
      {/* Create form */}
      <CreateAuctionForm
        eligibleItems={eligibleItems}
        playerCredits={playerCredits}
        minDurationHours={minDurationHours}
        maxDurationDays={maxDurationDays}
        defaultDurationHours={defaultDurationHours}
      />

      {/* My listings */}
      {myAuctions.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">
            Your Auctions
          </h2>
          <div className="space-y-2 stagger-children">
            {myAuctions.map((a) => (
              <AuctionCard key={a.id} auction={a} playerId={playerId} playerCredits={playerCredits} />
            ))}
          </div>
        </section>
      )}

      {/* All open auctions */}
      {otherAuctions.length > 0 ? (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">
            Open Auctions
          </h2>
          <div className="space-y-2 stagger-children">
            {otherAuctions.map((a) => (
              <AuctionCard key={a.id} auction={a} playerId={playerId} playerCredits={playerCredits} />
            ))}
          </div>
        </section>
      ) : (
        auctions.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center border border-dashed border-zinc-800 rounded-lg">
            <svg className="w-8 h-8 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <p className="text-sm text-zinc-600">No active auctions right now.</p>
            <p className="text-xs text-zinc-700">Be the first to put a colony or stewardship up for sale.</p>
          </div>
        )
      )}
    </div>
  );
}
