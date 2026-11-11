import type { ReactNode } from "react";
import { MinusIcon, TrendDownIcon, TrendUpIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

/**
 * A row of headline figures in one ink frame, each figure its own
 * compartment (round 2, Oct 15 2026, back toward the original's stat cards):
 * the label, the number and what it counts. The 2px lines between them are
 * the frame's own ink showing through the gaps, and every row fills its
 * width, so no empty cell is ever left showing. On a phone they stack.
 */
export function FigureRow({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={cn("flex flex-wrap gap-[2px] border-2 border-border bg-border shadow-hard-sm", className)}>
      {children}
    </div>
  );
}

const TONE = {
  paper: "bg-card text-foreground",
  lime: "bg-primary text-primary-foreground",
  ink: "bg-[#141414] text-white",
} as const;

/**
 * What a figure says against its yardstick, in a chip under the number: which
 * way (up, down, level), and whether that's good, bad or neither. The words
 * carry it ("3.0 points above the field"); the arrow and the fill repeat it
 * for the eye, never alone. Ink words on the soft fills (WCAG 1.4.3); the
 * arrows are -ink on the same fills, 4.3:1 or more in both themes (1.4.11).
 */
export interface FigureTrend {
  text: string;
  dir: "up" | "down" | "level";
  /** good and bad colour the chip; info is a change that's neither (more filings). */
  tone: "good" | "bad" | "info" | "neutral";
}

const TREND_FILL: Record<FigureTrend["tone"], string> = {
  good: "bg-soft-good",
  bad: "bg-soft-bad",
  info: "bg-soft-info",
  neutral: "bg-muted",
};

const TREND_INK: Record<FigureTrend["tone"], string> = {
  good: "text-data-good-ink",
  bad: "text-data-bad-ink",
  info: "text-data-info-ink",
  neutral: "text-muted-foreground",
};

export function TrendChip({ trend, className }: { trend: FigureTrend; className?: string }) {
  const Arrow = trend.dir === "up" ? TrendUpIcon : trend.dir === "down" ? TrendDownIcon : MinusIcon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-semibold leading-snug text-foreground", TREND_FILL[trend.tone], className)}>
      <Arrow aria-hidden="true" weight="bold" className={cn("size-4 shrink-0", TREND_INK[trend.tone])} />
      {trend.text}
    </span>
  );
}

/** A figure that is a number: digits with their separators, a currency sign before or a percent or short unit after. */
const NUMBER = /^[$€£]?\d[\d,.]*\s?(?:%|[A-Za-z]{1,4})?$/;

export function Figure({
  label,
  value,
  note,
  tone = "paper",
  icon,
  trend,
  visual,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** A small picture of what the figure measures (FigureVisual.tsx), drawn under the number. */
  visual?: ReactNode;
  /** A small icon before the label, saying at a glance what the figure is. */
  icon?: ReactNode;
  /** The figure against its yardstick, as a coloured chip under the number. */
  trend?: FigureTrend;
  /** One figure in a row may stand out: the lime one is the reader's own. */
  tone?: keyof typeof TONE;
}) {
  // A number is one word. In a row of five tiles a wage as long as "$119,350" was wider than its tile, and the
  // page's own break-word rule split it across two lines. A number keeps to one line, and its tile never shrinks
  // below it: the row wraps a tile down instead. Words still wrap as before.
  const number = typeof value === "string" && NUMBER.test(value.trim());
  return (
    <div className={cn("flex-1 basis-40 px-4 py-3.5 sm:px-5 sm:py-4", number ? "min-w-min" : "min-w-0", TONE[tone])}>
      <p className="flex items-center gap-1.5 text-sm font-bold">
        {icon ? <span aria-hidden="true" className="inline-flex shrink-0 [&_svg]:size-4">{icon}</span> : null}
        {label}
      </p>{" "}
      {/* A number is the figure, so it's the largest thing in the card. A name or a date is words: set a step
          smaller, it reads as a name and wraps inside its card, where at a number's size one long name made its
          card twice the height of its neighbours. */}
      <p
        className={cn(
          "mt-1.5 font-heading font-bold tabular-nums",
          number ? "whitespace-nowrap text-[1.75rem] leading-none sm:text-[2rem]" : "text-xl leading-tight sm:text-[1.375rem]",
        )}
      >
        {value}
      </p>{" "}
      {visual ? <div className="mt-2.5">{visual}</div> : null}{" "}
      {trend ? <TrendChip trend={trend} className="mt-2" /> : null}{" "}
      {note ? (
        <p className={cn("mt-1.5 text-sm leading-snug", tone === "paper" ? "text-muted-foreground" : "opacity-85")}>{note}</p>
      ) : null}
    </div>
  );
}
