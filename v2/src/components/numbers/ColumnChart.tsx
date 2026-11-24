import { Fragment } from "react";

import { ChartTips } from "@/components/data/ChartTips";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { keepWhole } from "@/components/ui/keep-whole";

/**
 * Columns for a short series (weeks, days, readings), drawn in HTML so every
 * label stays at its CSS size on a phone, with a hover and tap readout from
 * `ChartTips` and the same numbers in a table for screen readers.
 *
 * A COLUMN IS A SOFT FILL WITH AN INK CAP. The soft chart colours sit near
 * 1.2:1 against the tint, under WCAG 1.4.11's 3:1 for a mark a reader needs;
 * the 2px cap in the colour's ink is what passes, the same way the pulse's
 * typical week does.
 *
 * The column marked `now` is lime (rule 3: lime marks now), hatched when it
 * is still filling, so a week in progress never reads as a drop. A period no
 * record covers is a dashed outline the chart's full height: an empty frame
 * reads as "nothing to show here", where a zero-height column reads as "none".
 * Either one, when a chart has it, is named in a key under the columns
 * (Oct 31 2026: the wait charts drew both and said what neither meant).
 */

export type ColumnTone = "yellow" | "blue" | "green";

const FILL: Record<ColumnTone, string> = {
  yellow: "bg-chart-yellow border-data-warn-ink",
  blue: "bg-chart-blue border-data-info-ink",
  green: "bg-chart-green border-data-good-ink",
};

export interface ColumnPart {
  value: number;
  /** A fill class for one part of a stacked column. */
  fill: string;
  /** The part's name ("Certified"): with one, the screen-reader table gives each part its own column. */
  label?: string;
}

export interface Column {
  key: string;
  value: number;
  /** The hover readout, lines split by "\n". */
  tip: string;
  /** The column the chart is about: today, this week. Drawn lime. */
  now?: boolean;
  /** Still filling (a week in progress). */
  partial?: boolean;
  /** No record covers this period: drawn as an empty dashed outline, never as zero. */
  gap?: boolean;
  /** Stacked parts, bottom first; they replace the tone. */
  parts?: ColumnPart[];
  /** The table's row label. */
  label: string;
  /** Where a click on the column goes. */
  href?: string;
  /** A short label printed above the column ("Jan ’26"), for a chart read without hovering. */
  top?: string;
  /** A value to set the column against, drawn as a short ink line across it: the same days a year earlier. */
  mark?: number;
}

export function ColumnChart({
  columns,
  tone = "blue",
  label,
  first,
  last,
  unit,
  className,
  height = "h-36 sm:h-40",
  grow = false,
  showMax = true,
  topsFrom,
  scaleMax,
  gapKey = "No record for this period",
  partialKey = "Still filling",
  markKey = "A year earlier",
}: {
  columns: readonly Column[];
  tone?: ColumnTone;
  /** What the chart shows: the keyboard announcement, the image label and the table caption. */
  label: string;
  /** The tick under the first and the last column. */
  first: string;
  last: string;
  /** "cases", "RFIs": the table's value heading. */
  unit: string;
  className?: string;
  /** The columns' height; with `grow`, their least height. */
  height?: string;
  /** Fill the rest of a tile: the columns take whatever height the tile has left. */
  grow?: boolean;
  /** Print the largest value above the columns (off where the value isn't a count). */
  showMax?: boolean;
  /**
   * The width from which the `top` labels print. Many narrow columns crowd their
   * labels into one another on a phone ("10.310.3"); below this width the hover
   * and tap readout carries each figure instead.
   */
  topsFrom?: "sm" | "xl";
  /** The value a full-height column stands for, so two charts side by side share one scale. */
  scaleMax?: number;
  /** The key's words for a dashed, empty column, shown only when the chart has one. */
  gapKey?: string;
  /** The key's words for a hatched column still filling, shown only when the chart has one. */
  partialKey?: string;
  /** The key's words and the table's heading for the columns' marks, shown only when a column has one. */
  markKey?: string;
}) {
  if (columns.length === 0) return null;
  const max = Math.max(1, scaleMax ?? 0, ...columns.filter((c) => !c.gap).map((c) => c.value), ...columns.map((c) => c.mark ?? 0));
  const marked = columns.some((c) => c.mark !== undefined);
  // The named parts of the stacked columns, in order, each a column of the table.
  const partNames = columns.find((c) => c.parts?.every((p) => p.label))?.parts?.map((p) => p.label!) ?? [];
  // A ring in the card's colour keeps the line readable where it crosses a dark column.
  const markOf = (c: Column) =>
    c.mark === undefined ? null : (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 z-10 h-[3px] bg-foreground ring-1 ring-card"
        style={{ bottom: `calc(${(c.mark / max) * 100}% - 1px)` }}
      />
    );
  const labelled = columns.some((c) => c.top);
  const topShown = topsFrom === "sm" ? "hidden sm:block" : topsFrom === "xl" ? "hidden xl:block" : "";
  const topRoom = topsFrom === "sm" ? "sm:pt-7" : topsFrom === "xl" ? "xl:pt-7" : "pt-7";
  return (
    <div className={cn(grow && "flex flex-1 flex-col", className)}>
      {showMax ? <p className="text-sm tabular-nums text-muted-foreground">{formatInt(max)}</p> : null}{" "}
      <ChartTips label={label} className={cn(grow && "flex flex-1 flex-col")}>
        <div
          className={cn("mt-1 flex items-end gap-[3px] border-b-2 border-input", height, grow && "flex-1", labelled && topRoom)}
          role="img"
          aria-label={`${label}: from ${formatInt(Math.min(...columns.filter((c) => !c.gap).map((c) => c.value), max))} to ${formatInt(max)}.`}
        >
          {columns.map((c) => {
            if (c.gap) {
              return (
                <div
                  key={c.key}
                  data-tip={c.tip}
                  data-href={c.href}
                  className="relative h-full flex-1 border-2 border-dashed border-input"
                >
                  {markOf(c)}
                </div>
              );
            }
            const h = c.value > 0 ? Math.max(2, (c.value / max) * 100) : 0;
            if (c.parts?.length) {
              // A stacked column's label sits at the top of its whole slot, in
              // the padding above the tallest bar, so it can't run into a
              // taller neighbour the way a label on the bar's own top did.
              const bar = (
                <div
                  data-tip={c.tip}
                  data-href={c.href}
                  className={cn(
                    "flex w-full flex-col-reverse",
                    c.now && "outline outline-2 outline-offset-1 outline-foreground",
                    c.partial && "outline outline-2 outline-dashed outline-offset-1 outline-foreground",
                  )}
                  style={{ height: `${h}%` }}
                >
                  {c.parts.map((p, i) => (
                    <div key={i} className={p.fill} style={{ height: `${c.value ? (p.value / c.value) * 100 : 0}%` }} />
                  ))}
                </div>
              );
              if (!c.top) {
                return (
                  <div key={c.key} className="relative flex h-full flex-1 items-end">
                    {bar}
                    {markOf(c)}
                  </div>
                );
              }
              return (
                <div key={c.key} className="relative flex h-full flex-1 items-end">
                  <span
                    className={cn("absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground", topShown)}
                    aria-hidden="true"
                  >
                    {c.top}{" "}
                  </span>{" "}
                  {bar}
                  {markOf(c)}
                </div>
              );
            }
            const plain = (
              <div
                key={c.key}
                data-tip={c.tip}
                data-href={c.href}
                className={cn(
                  "relative border-t-2",
                  c.mark === undefined ? "flex-1" : "w-full",
                  c.now ? "border-foreground bg-primary" : FILL[tone],
                  // A whole outline around the stripes: with a top line alone, a short
                  // striped bar (and the key's small square) read as the letter Z.
                  c.partial && "border-2 border-foreground bg-hatch text-input",
                )}
                style={{ height: `${h}%` }}
              >
                {c.top ? (
                  <span className={cn("absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm tabular-nums text-soft", topShown)} aria-hidden="true">
                    {c.top}{" "}
                  </span>
                ) : null}
              </div>
            );
            if (c.mark === undefined) return plain;
            return (
              <div key={c.key} className="relative flex h-full flex-1 items-end">
                {plain}
                {markOf(c)}
              </div>
            );
          })}
        </div>
      </ChartTips>{" "}
      <div className="mt-2 flex justify-between gap-4 text-sm tabular-nums text-muted-foreground">
        <span>{first}</span>{" "}
        <span>{last}</span>
      </div>{" "}
      {columns.some((c) => c.gap) || columns.some((c) => c.partial) || marked ? (
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground" aria-label="Key">
          {columns.some((c) => c.gap) ? (
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-1 inline-block size-3.5 shrink-0 border-2 border-dashed border-input" />
              {gapKey}{" "}
            </li>
          ) : null}{" "}
          {columns.some((c) => c.partial) ? (
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 inline-block size-4 shrink-0 border-2 border-foreground bg-hatch text-input" />
              {partialKey}{" "}
            </li>
          ) : null}{" "}
          {marked ? (
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 inline-block h-[3px] w-4 shrink-0 bg-foreground ring-1 ring-card" />
              {markKey}{" "}
            </li>
          ) : null}
        </ul>
      ) : null}
      {/* sr-only on a <table> can't shrink it below its content; a div can. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Period{" "}</th>
              <th scope="col">{unit}{" "}</th>
              {partNames.map((n) => (
                <th key={n} scope="col">
                  {n}{" "}
                </th>
              ))}
              {marked ? <th scope="col">{markKey}{" "}</th> : null}
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <Fragment key={c.key}>
                <tr>
                  <td>{keepWhole(c.label)}{" "}</td>
                  <td>{c.gap ? "No record" : `${formatInt(c.value)}${c.partial ? " so far" : ""}`}{" "}</td>
                  {partNames.map((n, i) => (
                    <td key={n}>{c.gap ? "" : formatInt(c.parts?.[i]?.value ?? 0)}{" "}</td>
                  ))}
                  {marked ? <td>{c.mark === undefined ? "No record" : formatInt(c.mark)}{" "}</td> : null}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
