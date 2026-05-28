"use client";

import { useState, useEffect } from "react";

function formatDuration(ms: number): string {
  if (ms <= 0) return "Now";
  const totalSec = Math.floor(ms / 1000);
  const days  = Math.floor(totalSec / 86400);
  const hrs   = Math.floor((totalSec % 86400) / 3600);
  const mins  = Math.floor((totalSec % 3600) / 60);
  const secs  = totalSec % 60;
  if (days > 0)  return `${days}d ${hrs}h`;
  if (hrs > 0)   return `${hrs}h ${mins}m`;
  if (mins > 0)  return `${mins}m ${secs}s`;
  return `${secs}s`;
}

interface CountdownProps {
  /** ISO timestamp string of when the event completes */
  target: string | null | undefined;
  /** Text shown when target has passed */
  doneLabel?: string;
  className?: string;
}

/**
 * Live countdown timer that ticks every second.
 * Renders "Xh Ym Zs" format, collapses units as time decreases.
 * Shows doneLabel once the target timestamp passes.
 */
export function Countdown({ target, doneLabel = "Complete", className = "" }: CountdownProps) {
  const [msLeft, setMsLeft] = useState<number>(() =>
    target ? Math.max(0, new Date(target).getTime() - Date.now()) : 0,
  );

  useEffect(() => {
    if (!target) return;
    const end = new Date(target).getTime();
    const tick = () => setMsLeft(Math.max(0, end - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return null;

  const done = msLeft <= 0;
  return (
    <span className={className}>
      {done ? doneLabel : formatDuration(msLeft)}
    </span>
  );
}
