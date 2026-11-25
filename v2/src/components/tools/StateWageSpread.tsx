"use client";

import { Fragment, useState } from "react";

import { ChartTips } from "@/components/data/ChartTips";
import { choiceVariants } from "@/components/ui/choice";
import { Pager } from "@/components/ui/pager";
import { ScrollBox } from "@/components/ui/scroll-box";
import { SplitLadderNote } from "@/components/wages/SplitLadderNote";
import { formatDollars, formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Ladder } from "@/lib/wageLadder";

/** One state's offered wages: the count, the average and the percentiles (the 10th and 90th when the row has them). */
export interface StateSpreadRow {
  state: string;
  n: number;
  avg: number | null;
  p5: number | null;
  p10?: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90?: number | null;
  p95: number | null;
}

const PER_PAGE = 15;
/** Tails and bands only from this many cases: under it the ends move with a handful of filings. */
const SPREAD_MIN = 100;
const usd = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : formatDollars(n));
/** An axis end, short enough for a phone: $17k, $506k. */
const short = (n: number) => `$${Math.round(n / 1000).toLocaleString("en-US")}k`;

/**
 * Every state's offered wages on one shared scale, a page at a time, busiest first: the light band from the 5th to the
 * 95th percentile, the darker one from the 25th to the 75th, ticks at the 10th and 90th, and the median's mark. The
 * wages page's one state chart since Nov 25 2026, when the explorer's "By worksite state" and the "Every state on one
 * axis" chapter were merged keeping everything either showed. It follows the explorer's filters.
 */
export function StateWageSpread({ rows, nounPlural, minCases }: { rows: StateSpreadRow[]; nounPlural: string; minCases: number }) {
  const [page, setPage] = useState(1);
  const drawable = rows.filter((r) => r.p50 !== null);
  if (drawable.length === 0) return null;
  const tens = rows.some((r) => r.p10 != null || r.p90 != null);
  const pages = Math.max(1, Math.ceil(drawable.length / PER_PAGE));
  const at = Math.min(page, pages);
  const shown = drawable.slice((at - 1) * PER_PAGE, at * PER_PAGE);
  const spread = (r: StateSpreadRow) => r.n >= SPREAD_MIN && r.p5 !== null && r.p95 !== null;
  // One scale for the page's states: across every page, one state's 95th near $500,000 squeezed the rest into a
  // third of the width (Nov 25 2026). The table holds every figure on any page.
  const lo = Math.min(...shown.map((r) => (spread(r) ? (r.p5 as number) : (r.p50 as number))));
  const hi = Math.max(...shown.map((r) => (spread(r) ? (r.p95 as number) : (r.p50 as number))));
  const span = Math.max(1, hi - lo);
  const x = (v: number) => `${((v - lo) / span) * 100}%`;
  const w = (a: number, b: number) => `${((b - a) / span) * 100}%`;
  const ladders: Ladder[] = rows
    .filter((r) => r.n >= SPREAD_MIN)
    .map((r) => ({
      label: r.state, key: r.state, count: r.n, p5: r.p5, p10: r.p10 ?? null, p25: r.p25, p50: r.p50,
      p75: r.p75, p90: r.p90 ?? null, p95: r.p95, mean: r.avg,
    }));
  const columns = ["State", "Cases", "5th", ...(tens ? ["10th"] : []), "25th", "Median", "75th", ...(tens ? ["90th"] : []), "95th", "Average"];
  return (
    <div id="by-state" className="mt-10 scroll-mt-24">
      <h3 className="font-heading text-xl font-bold">Every state on one axis</h3>{" "}
      <p className="mt-2 text-base text-muted-foreground">
        States with at least {minCases} matching {nounPlural}, most first, each page on one shared scale. The light band runs from
        the 5th to the 95th percentile, the darker one from the 25th to the 75th, and the dark mark is the median.
        {tens ? " Small ticks mark the 10th and 90th." : ""}
      </p>{" "}
      <SplitLadderNote ladders={ladders} className="mt-3" />
      <ChartTips label={`Offered wages by worksite state, page ${at} of ${pages}`} className="mt-5">
        <ol className="space-y-1.5">
          {shown.map((r) => {
            const ends = spread(r);
            const tip = [
              r.state,
              `${formatInt(r.n)} ${nounPlural}`,
              `Median ${usd(r.p50)}, average ${usd(r.avg)}`,
              ends ? `25th ${usd(r.p25)}, 75th ${usd(r.p75)}` : null,
              ends && r.p10 != null && r.p90 != null ? `10th ${usd(r.p10)}, 90th ${usd(r.p90)}` : null,
              ends ? `5th ${usd(r.p5)}, 95th ${usd(r.p95)}` : null,
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <Fragment key={r.state}>
                <li data-tip={tip} className="grid grid-cols-[2.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 [&>*]:min-w-0">
                  <span className="font-mono text-sm font-bold">{r.state}</span>{" "}
                  <span className="relative block h-5">
                    {ends ? (
                      <span aria-hidden="true" className="absolute inset-y-1 border border-data-good-ink bg-chart-green"
                        style={{ left: x(r.p5 as number), width: w(r.p5 as number, r.p95 as number) }} />
                    ) : null}
                    {ends && r.p25 !== null && r.p75 !== null ? (
                      <span aria-hidden="true" className="absolute inset-y-0 bg-data-good-ink/60"
                        style={{ left: x(r.p25), width: w(r.p25, r.p75) }} />
                    ) : null}
                    {ends && r.p10 != null ? (
                      <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-data-good-ink" style={{ left: x(r.p10) }} />
                    ) : null}
                    {ends && r.p90 != null ? (
                      <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-data-good-ink" style={{ left: x(r.p90) }} />
                    ) : null}
                    <span aria-hidden="true" className="absolute inset-y-0 w-1.5 -translate-x-1/2 bg-foreground ring-1 ring-background"
                      style={{ left: x(r.p50 as number) }} />
                  </span>{" "}
                  <span className="text-right text-sm font-bold tabular-nums">{usd(r.p50)}</span>
                </li>{" "}
              </Fragment>
            );
          })}
        </ol>
        <div aria-hidden="true" className="mt-2 grid grid-cols-[2.5rem_minmax(0,1fr)_5.5rem] gap-3 text-sm tabular-nums text-muted-foreground [&>*]:min-w-0">
          <span />{" "}
          <span className="flex justify-between gap-2">
            <span>{short(lo)}</span>{" "}
            <span>{short(hi)}</span>
          </span>{" "}
          <span className="text-right">median</span>
        </div>
        {drawable.some((r) => !spread(r)) ? (
          <p className="mt-2 text-sm text-muted-foreground">
            A state with fewer than {SPREAD_MIN} {nounPlural} shows its median alone.
          </p>
        ) : null}
      </ChartTips>{" "}
      {pages > 1 ? (
        <Pager
          page={at}
          hasPrevious={at > 1}
          hasNext={at < pages}
          onPrevious={() => setPage(at - 1)}
          onNext={() => setPage(at + 1)}
          noun="page"
          id="state-spread-pages"
          buttonClassName={choiceVariants()}
        >
          <p className="text-sm text-muted-foreground">{`${formatInt(drawable.length)} states, ${PER_PAGE} to a page`}</p>
        </Pager>
      ) : null}{" "}
      <details className="mt-5 border-t-2 border-[var(--object-border)]">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-bold">
          {`All ${formatInt(rows.length)} states, as a table`}
        </summary>
        <ScrollBox label="Every state, as a table" className="border-t border-border">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="dark border-b border-black bg-[#141414] text-foreground">
              <tr>
                {columns.map((h, i) => (
                  <th key={h} scope="col" className={cn("px-3 py-2 text-sm font-bold", i > 0 && "text-right")}>
                    {h}{" "}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ends = r.n >= SPREAD_MIN;
                const cells = [
                  formatInt(r.n),
                  ends ? usd(r.p5) : "n/a",
                  ...(tens ? [ends ? usd(r.p10) : "n/a"] : []),
                  usd(r.p25),
                  usd(r.p50),
                  usd(r.p75),
                  ...(tens ? [ends ? usd(r.p90) : "n/a"] : []),
                  ends ? usd(r.p95) : "n/a",
                  usd(r.avg),
                ];
                return (
                  <tr key={r.state} className={cn("border-t-2 border-border", i % 2 === 1 && "bg-sage")}>
                    <th scope="row" className="px-3 py-2 font-bold">
                      {r.state}{" "}
                    </th>
                    {cells.map((c, j) => (
                      <td key={columns[j + 1]} className={cn("px-3 py-2 text-right tabular-nums", columns[j + 1] === "Median" && "font-bold")}>
                        {c}{" "}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollBox>
      </details>
    </div>
  );
}
