import { cn } from "@/lib/utils";

/**
 * The small picture inside a summary figure: what the number measures, drawn.
 *
 * A figure that moves gets a spark line, and a figure that is a share of
 * something gets a split bar. Neither stands alone: the figure's chip and its
 * note say the same thing in words, so the spark line is hidden from a screen
 * reader and the split bar carries one sentence as its name.
 */

/** A line of how a figure has moved, oldest first, with the newest point marked. No axes: the number above is the scale. */
export function Spark({ values, className }: { values: readonly number[]; className?: string }) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const w = 120;
  const h = 32;
  const pad = 4;
  const min = Math.min(...clean);
  const span = Math.max(...clean) - min || 1;
  const pts = clean.map((v, i) => ({
    x: pad + (i * (w - 2 * pad)) / (clean.length - 1),
    y: h - pad - ((v - min) / span) * (h - 2 * pad),
  }));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false" className={cn("block max-w-full overflow-visible", className)}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* "Now": the one lime mark, with an ink edge so it reads on paper (lime alone is 2:1). */}
      <circle cx={last.x} cy={last.y} r="3.5" fill="var(--primary)" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const PART = {
  good: "bg-data-good",
  wait: "bg-data-warn",
  bad: "bg-data-bad",
  info: "bg-data-info",
  none: "bg-data-none",
} as const;

export interface SplitPart {
  value: number;
  tone: keyof typeof PART;
}

/**
 * One bar cut by share, in the site's status colours (decided green, waiting
 * yellow). `label` is the whole picture in a sentence, read in place of the bar.
 * A part too small to see still gets 2px, so "some" never draws as "none".
 */
export function SplitBar({ parts, label, className }: { parts: readonly SplitPart[]; label: string; className?: string }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((n, p) => n + p.value, 0);
  if (total <= 0) return null;
  return (
    <div role="img" aria-label={label} className={cn("flex h-3 w-full max-w-[12rem] gap-px border-2 border-border bg-border", className)}>
      {shown.map((p, i) => (
        <span key={i} className={cn("block h-full min-w-[2px]", PART[p.tone])} style={{ flexGrow: p.value, flexBasis: 0 }} />
      ))}
    </div>
  );
}
