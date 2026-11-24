"use client";

import { useRef } from "react";
import Link from "next/link";

import { ChartTips } from "@/components/data/ChartTips";
import { ROW_LINK } from "@/components/entities/caseRows";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Pagination, usePagedRows } from "@/components/ui/pagination";
import { ScrollBox } from "@/components/ui/scroll-box";

/**
 * One of ICE's top-200 lists, a page at a time: 25 rows on a wide screen, 10 on a phone, with the pager and the
 * rows-per-page choice under it.
 *
 * A client component on purpose: a server component's whole rendered tree goes into the page's data a second time,
 * while a client component's props go in once, as plain data. Rendered on the server, /opt-employers was 3.3 MB, 2 MB
 * of it that data (Oct 21 2026). And only the page on screen is drawn: all eight lists drawn whole were 1,604 table
 * rows, 1.2 MB of the page's 1.58 MB of HTML (Nov 23 2026), where Googlebot reads only a page's first 2 MB (Google's
 * Googlebot page, updated Feb 3 2026). Every rank stays a pager away.
 */

export interface SevpTableRow {
  rank: number;
  employer: string;
  total: number;
  opt: number | null;
  stemOpt: number | null;
}

const fmt = (n: number | null) => (n === null ? "" : formatInt(n));

export function SevpRowsTable({
  opt,
  rows,
  label,
}: {
  /** The OPT and STEM OPT list (three counts) rather than CPT (one). */
  opt: boolean;
  /** The whole list, in ICE's order. */
  rows: readonly SevpTableRow[];
  /** What the list is ("ICE's top employers for CPT, 2024"), for the chart's tab stop and the pager. */
  label: string;
}) {
  const top = useRef<HTMLDivElement>(null);
  const paged = usePagedRows(rows);
  // Every bar is drawn against the list's leader, whichever page is showing.
  const lead = rows[0]?.total || 1;
  return (
    <div ref={top} className="scroll-mt-24">
      {/* The tooltip sits outside the scrolling table, which would clip it. */}
      <ChartTips label={label}>
        {/* A card ground of its own, so the sage bar tracks read on any panel. */}
        <ScrollBox label={opt ? "Employers of OPT and STEM OPT students" : "Employers of CPT students"} className="border-t-2 border-[var(--object-border)] bg-card">
          <table className="w-full min-w-[560px] text-left text-base">
            <thead className="border-b-2 border-border bg-sage">
              <tr>
                <th scope="col" className="w-12 px-3 py-2 font-bold">#{" "}</th>
                <th scope="col" className="px-3 py-2 font-bold">Employer, as ICE names it{" "}</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">{opt ? "OPT or STEM OPT" : "CPT"}{" "}</th>
                {opt ? <th scope="col" className="px-3 py-2 text-right font-bold">OPT{" "}</th> : null}
                {opt ? <th scope="col" className="px-3 py-2 text-right font-bold">STEM OPT{" "}</th> : null}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {paged.shown.map((r, i) => (
                <tr key={r.rank} className={cn("border-b border-border last:border-b-0", paged.hide(i))}>
                  <td className="px-3 py-2 font-mono text-sm">{r.rank}{" "}</td>
                  <th scope="row" className="px-3 py-2 font-normal">
                    <Link href={`/perm-employers?q=${encodeURIComponent(r.employer)}`} className={ROW_LINK}>
                      {r.employer}
                    </Link>{" "}
                    {/* The counts sit to the right, off a phone's screen; the
                        total is printed by the bar there too. */}
                    <span className="mt-1 flex max-w-xs items-center gap-2" aria-hidden="true">
                      <span
                        className="block h-2 min-w-0 flex-1 bg-sage"
                        data-tip={[
                          r.employer,
                          `#${r.rank} of ${rows.length}`,
                          `${fmt(r.total)} ${opt ? "OPT or STEM OPT" : "CPT"}`,
                          opt && r.opt !== null ? `${fmt(r.opt)} OPT` : null,
                          opt && r.stemOpt !== null ? `${fmt(r.stemOpt)} STEM OPT` : null,
                        ]
                          .filter(Boolean)
                          .join("\n")}
                      >
                        <span className="block h-full bg-primary" style={{ width: `${Math.max(1, (r.total / lead) * 100)}%` }} />
                      </span>{" "}
                      <span className="shrink-0 text-sm font-bold tabular-nums sm:hidden">{fmt(r.total)}</span>
                    </span>{" "}
                  </th>
                  <td className="px-3 py-2 text-right font-bold">{fmt(r.total)}{" "}</td>
                  {opt ? <td className="px-3 py-2 text-right">{fmt(r.opt)}{" "}</td> : null}
                  {opt ? <td className="px-3 py-2 text-right">{fmt(r.stemOpt)}{" "}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      </ChartTips>{" "}
      <Pagination
        page={paged.page}
        pageCount={paged.pageCount}
        onPage={paged.setPage}
        total={rows.length}
        perPage={paged.perPage}
        noun="employers"
        label={`Pages of ${label}`}
        scrollTo={top}
        per={paged.per}
        className="mt-4"
      />
    </div>
  );
}
