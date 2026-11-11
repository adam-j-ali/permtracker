import { Fragment } from "react";

import { ChartTips } from "@/components/data/ChartTips";
import { cn } from "@/lib/utils";
import { monthTick, monthYear, shiftMonth } from "@convex/lib/months";

/**
 * The queue, drawn as a measuring tape.
 *
 * PERM's mental model is one line: every case waits in filing-month order and
 * DOL clears it oldest-first. This renders that line as an instrument strip —
 * cleared months in solid primary, waiting months in paper, the frontier
 * marked with a flag, and optionally the reader's own month.
 *
 * Presentational and server-renderable: months in, markup out. The timeline
 * calculator passes `selectedMonth` from its own state; the overview passes
 * none and shows the national picture.
 *
 * ON A PHONE THE WHOLE STRIP FITS. It was 560px wide in a box that scrolled
 * sideways and opened at its left end, so a case filed ten months behind DOL's
 * front had its "You" flag off the right edge with nothing saying the strip
 * scrolled. Below `sm` there's no fixed width: fewer months are labelled, "You"
 * takes its own row, and a flag at the strip's end stays inside it.
 */

export interface QueueTapeProps {
  /** DOL's analyst-review frontier, "YYYY-MM". */
  frontierMonth: string;
  /** The reader's filing month, "YYYY-MM". Optional. */
  selectedMonth?: string;
  /** Months to draw after the frontier. The wait, visually. */
  monthsAhead?: number;
  /** Months to draw before the frontier. Cleared territory. */
  monthsBehind?: number;
  /**
   * Said across the months between DOL's front and the reader's month, so the
   * empty stretch names what fills it ("80,416 cases ahead").
   */
  aheadLabel?: string;
  className?: string;
}

/** From `sm` up, a flag is about four columns wide, so two closer than this share a column's air. */
const FLAGS_COLLIDE_WITHIN = 4;
/** From `sm` up every other month is labelled; on a phone every fourth. */
const LABEL_EVERY = 2;
const PHONE_LABEL_EVERY = 4;
/** On a phone a label this close to a flagged month's label would touch it. */
const PHONE_LABEL_CLEAR_OF_FLAG = 2;
/** "DOL is here" is wider than three phone columns: this near the strip's start it's set from the column's edge. */
const PHONE_FLAG_EDGE_COLUMNS = 3;
/** The share of a phone's strip the stretch between the flags must cover to hold the cases-ahead words. */
const PHONE_AHEAD_LABEL_MIN_SHARE = 0.55;
/** The two flags have to be this many months apart for the words to sit between them at any width. */
const AHEAD_LABEL_MIN_MONTHS_APART = 3;

/** What a month on the tape means, for its hover detail. */
function tipFor(month: string, offset: number, isYou: boolean): string {
  const state =
    offset < 0
      ? "DOL has worked through these filings"
      : offset === 0
        ? "DOL is deciding these filings now"
        : `${offset} ${offset === 1 ? "month" : "months"} behind where DOL is`;
  return `${monthYear(month) ?? month}\n${state}${isYou ? "\nYour filing month" : ""}`;
}

export function QueueTape({
  frontierMonth,
  selectedMonth,
  monthsAhead = 10,
  monthsBehind = 8,
  aheadLabel,
  className,
}: QueueTapeProps) {
  const months: string[] = [];
  for (let i = -monthsBehind; i <= monthsAhead; i += 1) {
    months.push(shiftMonth(frontierMonth, i));
  }

  // BOTH FLAGS USED THE SAME `-top-7 left-1/2 -translate-x-1/2`, so when the
  // two months are near each other the badges overlap: "DOL is here" is ~90px
  // wide over a column that can be ~30px, and "You" landed on top of it.
  // Reported from a screenshot with the two one month apart.
  //
  // When they collide, "You" goes up a row rather than being nudged sideways,
  // which would break the tie between a flag and the column it points at. On a
  // phone the columns are about 20px, so "You" always takes the upper row.
  const frontierAt = months.indexOf(frontierMonth);
  const youAt = selectedMonth ? months.indexOf(selectedMonth) : -1;
  const hasYou = youAt >= 0 && youAt !== frontierAt;
  const flagsCollide = frontierAt >= 0 && youAt >= 0 && Math.abs(youAt - frontierAt) < FLAGS_COLLIDE_WITHIN;
  const stretch = youAt - frontierAt - 1;
  const aheadFitsPhone = stretch / months.length >= PHONE_AHEAD_LABEL_MIN_SHARE;

  /** Which widths a month's label shows at: both, from `sm` only, or to screen readers alone. */
  const labelClass = (i: number): string => {
    if (i === frontierAt || i === youAt) return "";
    if (i % LABEL_EVERY !== 0) return "sr-only";
    const nearFlag = [frontierAt, youAt].some((f) => f >= 0 && Math.abs(i - f) < PHONE_LABEL_CLEAR_OF_FLAG);
    return i % PHONE_LABEL_EVERY !== 0 || nearFlag ? "max-sm:sr-only" : "";
  };

  return (
    <figure className={cn("m-0", className)}>
      <ChartTips
        label="DOL's PERM queue by filing month"
        scroll={cn("-mx-1 px-1", flagsCollide ? "pt-14" : hasYou ? "pt-14 sm:pt-7" : "pt-7")}
      >
        <div
          className="relative grid border-2 border-[var(--object-border)] bg-card shadow-hard-sm sm:min-w-[560px]"
          style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}
        >
          {aheadLabel && frontierAt >= 0 && youAt - frontierAt >= AHEAD_LABEL_MIN_MONTHS_APART ? (
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-y-0 z-[5] flex items-start justify-center pt-3",
                !aheadFitsPhone && "max-sm:hidden",
              )}
              style={{
                left: `${((frontierAt + 1) / months.length) * 100}%`,
                width: `${(stretch / months.length) * 100}%`,
              }}
            >
              <span className="bg-card px-2 font-heading text-sm font-bold whitespace-nowrap sm:text-base">{aheadLabel}</span>
            </span>
          ) : null}
          {months.map((m, i) => {
            const cleared = m < frontierMonth;
            const isFrontier = m === frontierMonth;
            const isYou = m === selectedMonth;
            return (
              <Fragment key={m}>{" "}
              <div
                data-href={`/perm-queue/${m}`}
                data-tip={tipFor(m, i - frontierAt, isYou)}
                className={cn(
                  "relative flex h-16 items-end justify-center border-r border-foreground/10 pb-1 last:border-r-0",
                  // Still waiting reads soft yellow, not blank (round 3, Oct 15 2026).
                  !cleared && !isFrontier && "bg-soft-wait",
                  cleared && "bg-primary",
                  isFrontier && "bg-primary/70",
                )}
              >
                {/* Tick */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-1/2 top-0 h-2 w-px",
                    cleared || isFrontier ? "bg-data-good-ink" : "bg-data-warn",
                  )}
                />
                <span
                  className={cn(
                    "relative text-center font-mono text-sm font-bold leading-none",
                    cleared || isFrontier ? "text-black/80" : "text-muted-foreground",
                    // Room is tight: see labelClass.
                    labelClass(i),
                  )}
                >
                  {(monthTick(m) ?? m)}
                </span>
                {/* Real space: the flag span is adjacent to the label span
                    and would glue for every DOM extractor. */}
                {" "}
                {isFrontier ? (
                  <span
                    className={cn(
                      "dark absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 text-sm font-bold border-2 border-black bg-[#141414] text-foreground",
                      i < PHONE_FLAG_EDGE_COLUMNS && "max-sm:left-0 max-sm:translate-x-0",
                      i >= months.length - PHONE_FLAG_EDGE_COLUMNS && "max-sm:left-auto max-sm:right-0 max-sm:translate-x-0",
                    )}
                  >
                    DOL is here
                  </span>
                ) : null}
                {isYou && !isFrontier ? (
                  <span
                    className={cn(
                      "absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap border-2 border-[var(--object-border)] bg-primary px-1.5 py-px text-sm font-bold text-black",
                      flagsCollide ? "-top-14" : "-top-14 sm:-top-7",
                      i === months.length - 1 && "max-sm:left-auto max-sm:right-0 max-sm:translate-x-0",
                      i === 0 && "max-sm:left-0 max-sm:translate-x-0",
                    )}
                  >
                    You
                  </span>
                ) : null}
                {isYou && !isFrontier ? (
                  // The raised flag is a row away from its column, so a hairline
                  // keeps them tied together: always on a phone, and from `sm`
                  // only when the two flags are close.
                  <span
                    aria-hidden="true"
                    className={cn("absolute -top-7 left-1/2 h-7 w-px -translate-x-1/2 bg-input", !flagsCollide && "sm:hidden")}
                  />
                ) : null}
              </div>
              </Fragment>
            );
          })}
        </div>
      </ChartTips>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-3 border border-foreground/40 bg-primary" />
          Processed
        </span>{" "}
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-3 border border-foreground/40 bg-soft-wait" />
          Still pending
        </span>
      </figcaption>
    </figure>
  );
}
