import { Fragment } from "react";

import { ChartTips } from "@/components/data/ChartTips";
import { formatInt } from "@/lib/format";
import type { MonthlyPoint } from "@/lib/uscisMonthly";
import { cn } from "@/lib/utils";

/**
 * One column per month of USCIS's monthly report to Congress: what it decided, approved in the status green and
 * denied in the status red on top. A month USCIS's data page doesn't list is an empty dashed column, never a zero:
 * nothing is known about it. Every month the doc holds is drawn, so a fall like the N-400's (about 80,000 decided a
 * month through 2025, about 23,000 by September 2026) reads at a glance against the years before it.
 */

const MONTH_LONG = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function MonthlyDecisionBars({
  months,
  nouns,
  label,
  className,
}: {
  /** Oldest first, from `everyMonth`. */
  months: { month: string; point: MonthlyPoint | null }[];
  /** "N-400s", "employment-based I-485s". */
  nouns: string;
  /** What the chart shows, for the keyboard and the screen-reader table. */
  label: string;
  className?: string;
}) {
  const decided = (p: MonthlyPoint | null) => (p && p.approved !== null && p.denied !== null ? p.approved + p.denied : null);
  const max = Math.max(1, ...months.map((m) => decided(m.point) ?? 0));
  if (months.filter((m) => decided(m.point) !== null).length < 3) return null;
  const anyGap = months.some((m) => decided(m.point) === null);

  return (
    <figure className={cn("m-0", className)}>
      <div aria-hidden="true" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 border border-border bg-data-good" /> Approved
        </span>{" "}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 border border-border bg-data-bad" /> Denied
        </span>{" "}
        {anyGap ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 border border-dashed border-muted-foreground" /> Month not listed by USCIS
          </span>
        ) : null}
      </div>{" "}
      <ChartTips label={label} className="mt-4">
        <div className="flex h-56 items-end gap-px sm:gap-0.5">
          {months.map(({ month, point }) => {
            const d = decided(point);
            if (d === null || !point) {
              return (
                <div key={month} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                  <div
                    data-tip={`${MONTH_LONG(month)}\nUSCIS's data page doesn't list this month's report`}
                    className="h-full border border-dashed border-muted-foreground/60"
                  />
                </div>
              );
            }
            const deniedShare = d > 0 ? (point.denied! / d) * 100 : 0;
            return (
              <div key={month} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <div
                  data-tip={`${MONTH_LONG(month)}\n${formatInt(d)} ${nouns} decided\n${formatInt(point.approved!)} approved\n${formatInt(point.denied!)} denied`}
                  className="flex flex-col border border-border"
                  style={{ height: `${Math.max(1, (d / max) * 100)}%` }}
                >
                  {point.denied! > 0 ? (
                    <div className="border-b border-border bg-data-bad" style={{ height: `${deniedShare}%` }} />
                  ) : null}
                  <div className="flex-1 bg-data-good" />
                </div>
              </div>
            );
          })}
        </div>
        {/* Hidden from a screen reader, which reads the table below instead: the year under each January. */}
        <div aria-hidden="true" className="mt-1.5 flex gap-px sm:gap-0.5">
          {months.map(({ month }, i) => (
            <span key={month} className="relative min-w-0 flex-1 text-sm tabular-nums text-muted-foreground">
              {month.endsWith("-01") || i === 0 ? (
                <span className="absolute left-0 whitespace-nowrap">{month.endsWith("-01") ? month.slice(0, 4) : ""}</span>
              ) : null}{" "}
            </span>
          ))}
        </div>
        <div aria-hidden="true" className="h-5" />
      </ChartTips>{" "}
      {/* The numbers for a screen reader. `sr-only` on the wrapper, never on the table. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Month{" "}</th>
              <th scope="col">Approved{" "}</th>
              <th scope="col">Denied{" "}</th>
            </tr>
          </thead>
          <tbody>
            {months.map(({ month, point }) => (
              <Fragment key={month}>
                <tr>
                  <th scope="row">{MONTH_LONG(month)}{" "}</th>
                  {decided(point) === null || !point ? (
                    <td colSpan={2}>Not listed by USCIS{" "}</td>
                  ) : (
                    <>
                      <td>{formatInt(point.approved!)}{" "}</td>
                      <td>{formatInt(point.denied!)}{" "}</td>
                    </>
                  )}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
