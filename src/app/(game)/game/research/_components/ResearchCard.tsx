/**
 * ResearchCard — server component.
 *
 * Renders a single research item as a styled card inside a progression chain.
 * All status logic is computed by the parent page; this component is
 * presentation-only and does not import from researchHelpers.
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
  const isUnlocked = status === "unlocked";
  const isPurchasable = status === "purchasable";
  const isLocked = status === "locked";
  const isReady = isPurchasable && canAfford;

  // ── Card shell ──────────────────────────────────────────────────────────────
  const cardBorder = isUnlocked
    ? "border-emerald-800 bg-emerald-950/20"
    : isReady
    ? "border-indigo-700/80 bg-indigo-950/20"
    : isPurchasable
    ? "border-amber-800/40 bg-zinc-900"
    : "border-zinc-800 bg-zinc-900/40";

  // ── Name text ───────────────────────────────────────────────────────────────
  const nameColor = isUnlocked
    ? "text-emerald-300"
    : isReady
    ? "text-zinc-100"
    : isPurchasable
    ? "text-zinc-300"
    : "text-zinc-500";

  // ── Tier badge ──────────────────────────────────────────────────────────────
  const tierBadge = isUnlocked
    ? "bg-emerald-900/60 text-emerald-400"
    : isReady
    ? "bg-indigo-900/60 text-indigo-300"
    : "bg-zinc-800 text-zinc-500";

  // ── Effect block ────────────────────────────────────────────────────────────
  const effectBg = def.scaffoldOnly
    ? "bg-zinc-800/30"
    : isUnlocked
    ? "bg-emerald-950/40"
    : isReady
    ? "bg-indigo-950/40"
    : "bg-zinc-800/20";

  const effectText = def.scaffoldOnly
    ? "text-zinc-500 italic"
    : isUnlocked
    ? "text-emerald-200/80"
    : isReady
    ? "text-amber-200/90 font-medium"
    : isPurchasable
    ? "text-zinc-400"
    : "text-zinc-600";

  return (
    <div
      className={`flex flex-col rounded-lg border px-3 py-2.5 gap-2 min-w-[170px] flex-1 ${cardBorder}`}
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
        {def.scaffoldOnly ? (
          <p className="text-xs text-zinc-500 italic">
            Future — no active gameplay effect yet.
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
        <div className="min-w-0 flex-1">
          {isLocked && !prereqsMet && (
            <p className="text-xs text-amber-600/90 leading-tight">
              Requires:{" "}
              <span className="font-medium">{blockingPrereqNames.join(", ")}</span>
            </p>
          )}
          {isLocked && prereqsMet && !milestonesMet && (
            <p className="text-xs text-amber-600/90 leading-tight">
              Needs:{" "}
              <span className="font-medium">
                {blockingMilestoneLabels.join(", ")}
              </span>
            </p>
          )}
          {isPurchasable && !canAfford && (
            <p className="text-xs text-amber-500/90 leading-tight">
              Need{" "}
              <span className="font-medium text-amber-400">{costLabel}</span>
            </p>
          )}
        </div>

        {/* Right column: status badge or cost + purchase button */}
        {isUnlocked ? (
          <span className="text-xs text-emerald-500 font-semibold shrink-0">
            ✓ Unlocked
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
