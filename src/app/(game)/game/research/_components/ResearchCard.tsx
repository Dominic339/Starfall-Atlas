/**
 * ResearchCard — server component.
 *
 * Renders a single research item as a styled card inside a progression chain.
 * All status logic is computed by the parent page; this component is
 * presentation-only and does not import from researchHelpers.
 *
 * Status matrix:
 *   scaffoldOnly                → "Coming Soon" state — no purchase button,
 *                                 grey card, future badge
 *   unlocked                    → green card, "✓ Unlocked" badge
 *   purchasable + can afford     → indigo card, enabled "Research →" button
 *   purchasable + cannot afford  → amber card, disabled button showing cost
 *   locked (prereqs / milestone) → dark grey, shows what is blocking
 */

import type { ResearchDefinition } from "@/lib/config/research";
import type { ResearchStatus } from "@/lib/game/researchHelpers";
import { PurchaseButton } from "./PurchaseButton";

export interface ResearchCardProps {
  def: ResearchDefinition;
  status: ResearchStatus;
  /** True when the player has enough resources to purchase right now. */
  canAfford: boolean;
  prereqsMet: boolean;
  milestonesMet: boolean;
  /** Names of unmet prerequisite research items. */
  blockingPrereqNames: string[];
  /** Human-readable unmet milestone labels. */
  blockingMilestoneLabels: string[];
  /** e.g. "300 iron" */
  costLabel: string;
  /** Tier badge text, e.g. "T2", "I", "II", "AMS". */
  tierLabel: string;
}

export function ResearchCard({
  def,
  status,
  canAfford,
  prereqsMet,
  milestonesMet,
  blockingPrereqNames,
  blockingMilestoneLabels,
  costLabel,
  tierLabel,
}: ResearchCardProps) {
  // Scaffold items are never purchasable — they always render in a
  // distinct "coming soon" state regardless of other flags.
  const isScaffold   = !!def.scaffoldOnly;
  const isUnlocked   = status === "unlocked";
  const isPurchasable = status === "purchasable" && !isScaffold;
  const isLocked     = status === "locked" || isScaffold;
  const isReady      = isPurchasable && canAfford;

  // ── Card shell ──────────────────────────────────────────────────────────────
  const cardBorder = isUnlocked
    ? "border-emerald-800 bg-emerald-950/20"
    : isReady
    ? "border-indigo-700/80 bg-indigo-950/20"
    : isPurchasable
    ? "border-amber-800/40 bg-zinc-900"
    : isScaffold
    ? "border-zinc-800/40 bg-zinc-900/20"
    : "border-zinc-800 bg-zinc-900/40";

  // ── Name text ───────────────────────────────────────────────────────────────
  const nameColor = isUnlocked
    ? "text-emerald-300"
    : isReady
    ? "text-zinc-100"
    : isPurchasable
    ? "text-zinc-300"
    : isScaffold
    ? "text-zinc-600"
    : "text-zinc-500";

  // ── Tier badge ──────────────────────────────────────────────────────────────
  const tierBadge = isUnlocked
    ? "bg-emerald-900/60 text-emerald-400"
    : isReady
    ? "bg-indigo-900/60 text-indigo-300"
    : isScaffold
    ? "bg-zinc-800/50 text-zinc-600"
    : "bg-zinc-800 text-zinc-500";

  // ── Effect block ────────────────────────────────────────────────────────────
  const effectBg = isScaffold
    ? "bg-zinc-800/20"
    : isUnlocked
    ? "bg-emerald-950/40"
    : isReady
    ? "bg-indigo-950/40"
    : "bg-zinc-800/20";

  const effectText = isScaffold
    ? "text-zinc-600 italic"
    : isUnlocked
    ? "text-emerald-200/80"
    : isReady
    ? "text-amber-200/90 font-medium"
    : isPurchasable
    ? "text-zinc-400"
    : "text-zinc-600";

  return (
    <div
      className={`flex flex-col rounded-lg border px-3 py-2.5 gap-2 min-w-[170px] flex-1 card-interactive ${cardBorder}`}
    >
      {/* ── Header: name + tier badge ─────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-semibold leading-snug ${nameColor}`}>
          {def.name}
        </p>
        {tierLabel && (
          <span
            className={`shrink-0 rounded text-xs font-mono px-1.5 py-0.5 leading-none ${tierBadge}`}
          >
            {tierLabel}
          </span>
        )}
      </div>

      {/* ── Effect / description block ────────────────────────────────────── */}
      <div className={`rounded px-2 py-1.5 flex-1 ${effectBg}`}>
        {isScaffold ? (
          <p className="text-xs text-zinc-600 italic">
            Not yet available — no active gameplay effect in this version.
          </p>
        ) : (
          <p className={`text-xs leading-relaxed ${effectText}`}>
            {def.description}
          </p>
        )}
      </div>

      {/* ── Footer: lock reasons + cost + button ─────────────────────────── */}
      <div className="flex items-end justify-between gap-2 flex-wrap">
        {/* Left column: why it's blocked */}
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          {isScaffold && (
            <span className="inline-flex items-center gap-1 text-xs text-zinc-600 bg-zinc-800/40 rounded px-1.5 py-0.5 w-fit">
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 1.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM7.25 5.5v4h1.5v-4h-1.5zm0 5v1.5h1.5V10.5h-1.5z" />
              </svg>
              Coming in a future update
            </span>
          )}
          {!isScaffold && isLocked && !prereqsMet && (
            <span className="inline-flex items-start gap-1 text-xs text-amber-600/90 bg-amber-950/30 ring-1 ring-amber-900/40 rounded px-1.5 py-0.5 w-fit max-w-full">
              <svg className="w-3 h-3 shrink-0 mt-px" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M6 4H4a2 2 0 0 0 0 4h2M10 4h2a2 2 0 0 0 0 4h-2M6 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </svg>
              <span className="leading-tight">
                Requires{" "}
                <span className="font-semibold text-amber-500">{blockingPrereqNames.join(", ")}</span>
              </span>
            </span>
          )}
          {!isScaffold && isLocked && prereqsMet && !milestonesMet && (
            <span className="inline-flex items-start gap-1 text-xs text-amber-600/90 bg-amber-950/30 ring-1 ring-amber-900/40 rounded px-1.5 py-0.5 w-fit max-w-full">
              <svg className="w-3 h-3 shrink-0 mt-px" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5L8 2z" />
              </svg>
              <span className="leading-tight">
                Needs{" "}
                <span className="font-semibold text-amber-500">{blockingMilestoneLabels.join(", ")}</span>
              </span>
            </span>
          )}
          {isPurchasable && !canAfford && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-500/90 bg-amber-950/20 rounded px-1.5 py-0.5 w-fit">
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM7.25 5.5v4h1.5v-4h-1.5zm0 5v1.5h1.5V10.5h-1.5z" />
              </svg>
              Need <span className="font-semibold text-amber-400">{costLabel}</span>
            </span>
          )}
        </div>

        {/* Right column: status badge or cost + purchase button */}
        {isUnlocked ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-semibold shrink-0 bg-emerald-950/40 ring-1 ring-emerald-800/50 px-1.5 py-0.5 rounded">
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M6.5 11.5 3 8l1-1 2.5 2.5 5-5 1 1z" />
            </svg>
            Unlocked
          </span>
        ) : isScaffold ? (
          <span className="text-xs text-zinc-700 shrink-0 font-mono bg-zinc-800/50 px-1.5 py-0.5 rounded">
            Future
          </span>
        ) : (
          <div className="shrink-0 text-right">
            <p
              className={`text-xs ${
                isPurchasable && !canAfford
                  ? "text-amber-500"
                  : "text-zinc-500"
              }`}
            >
              {costLabel}
            </p>
            {isPurchasable && (
              <PurchaseButton
                researchId={def.id}
                costLabel={costLabel}
                disabled={!canAfford}
                disabledReason={
                  !canAfford ? `Need ${costLabel}` : undefined
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
