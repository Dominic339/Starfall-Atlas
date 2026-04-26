/**
 * Shared SVG skin preview — renders a small marker icon representing a skin's
 * visual properties. Used in both the player shop and the admin dev tool.
 */

export function SkinPreview({
  visual,
  type,
  size = 32,
}: {
  visual: { color?: string; accentColor?: string; shape?: string };
  type: string;
  size?: number;
}) {
  const c  = visual.color       ?? (type === "fleet" ? "#c4b5fd" : type === "station" ? "#fbbf24" : "#a5b4fc");
  const ac = visual.accentColor ?? (type === "fleet" ? "#7c3aed" : type === "station" ? "#f59e0b" : "#6366f1");
  const cx = size / 2, cy = size / 2, r = size * 0.28;

  if (type === "station") {
    const s = size * 0.22;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <rect x={cx - s * 1.6} y={cy - s * 0.22} width={s * 3.2} height={s * 0.44} fill={c} rx={1} />
        <rect x={cx - s * 0.22} y={cy - s * 1.6} width={s * 0.44} height={s * 3.2} fill={c} rx={1} />
        <circle cx={cx} cy={cy} r={s * 0.6} fill={ac} />
        {([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2] as number[]).map((a, i) => (
          <circle key={i} cx={cx + Math.cos(a) * s * 1.6} cy={cy + Math.sin(a) * s * 1.6} r={s * 0.45} fill={ac} />
        ))}
      </svg>
    );
  }

  if (type === "fleet") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="#1a0a3d" stroke={ac} strokeWidth={1.5} />
        <polygon points={`${cx},${cy - r * 0.6} ${cx + r * 0.5},${cy + r * 0.35} ${cx - r * 0.5},${cy + r * 0.35}`} fill={c} />
      </svg>
    );
  }

  // ship
  const shape = visual.shape ?? "chevron";
  let pts = "";
  if (shape === "diamond")
    pts = `${cx},${cy - r} ${cx + r * 0.6},${cy} ${cx},${cy + r} ${cx - r * 0.6},${cy}`;
  else if (shape === "arrow")
    pts = `${cx},${cy - r} ${cx + r * 0.55},${cy + r * 0.7} ${cx},${cy + r * 0.3} ${cx - r * 0.55},${cy + r * 0.7}`;
  else if (shape === "delta")
    pts = `${cx},${cy - r * 0.9} ${cx + r * 0.75},${cy + r * 0.85} ${cx - r * 0.75},${cy + r * 0.85}`;
  else
    pts = `${cx},${cy - r} ${cx + r * 0.65},${cy + r * 0.7} ${cx},${cy + r * 0.25} ${cx - r * 0.65},${cy + r * 0.7}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="#1e1b4b" stroke={ac} strokeWidth={1.5} />
      <polygon points={pts} fill={c} />
    </svg>
  );
}

/** Rarity colour map — shared with admin and shop. */
export const RARITY_GLOW: Record<string, string> = {
  common:    "#6b7280",
  uncommon:  "#22c55e",
  rare:      "#3b82f6",
  legendary: "#f59e0b",
};
