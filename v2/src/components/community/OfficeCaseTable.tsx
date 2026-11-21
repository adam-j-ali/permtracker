"use client";

import { useRef, type ReactNode } from "react";

import { Pagination, usePagedRows } from "@/components/ui/pagination";
import { ScrollBox } from "@/components/ui/scroll-box";
import { cn } from "@/lib/utils";

/**
 * Every case people reported at an office, a page at a time: 25 rows on a wide screen, 10 on a phone, with the pager
 * and the rows-per-page choice under it.
 *
 * WHY NOT `PagedTable`. That keeps every row in the page and hides the rest with a style rule, which suits a list of a
 * hundred. The National Benefits Center holds over 1,500 reported cases, and drawn whole they were 3.49 MB of HTML on
 * Nov 20 2026 (each row twice: the HTML, and the data the browser hydrates from), past the 2 MB Googlebot reads. Here
 * each case arrives as its cells' text, and only the page on screen is drawn; the rows hold no links, so nothing a
 * crawler follows is lost.
 */
export function OfficeCaseTable({
  label,
  head,
  rows,
  noun,
  cellClassName,
}: {
  /** What the scrolling box holds, read out when it takes focus. */
  label: string;
  /** The `<thead>`. */
  head: ReactNode;
  /** One case a row, its cells' text in the head's order. */
  rows: readonly (readonly string[])[];
  /** What a row is, plural, for "26 to 50 of 1,568 cases". */
  noun: string;
  cellClassName: string;
}) {
  const top = useRef<HTMLDivElement>(null);
  const paged = usePagedRows(rows);
  return (
    <div ref={top} className="mt-4 scroll-mt-24">
      <ScrollBox label={label}>
        <table data-table="every-case">
          {head}
          <tbody>
            {paged.shown.map((cells, i) => (
              <tr key={paged.start + i} className={cn("border-b border-border", paged.hide(i))}>
                {cells.map((cell, j) => (
                  <td key={j} className={cellClassName}>
                    {cell}{" "}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>{" "}
      <Pagination
        page={paged.page}
        pageCount={paged.pageCount}
        onPage={paged.setPage}
        total={rows.length}
        perPage={paged.perPage}
        noun={noun}
        label={`Pages of ${noun}`}
        scrollTo={top}
        per={paged.per}
        className="mt-4"
      />
    </div>
  );
}
