"use client";

import { useId, useRef, type ReactNode } from "react";

import { Pagination, usePagedRows } from "@/components/ui/pagination";
import { ScrollBox } from "@/components/ui/scroll-box";
import { cn } from "@/lib/utils";

/**
 * A table drawn on the server, shown a page at a time: 25 rows on a wide screen, 10 on a phone, with a pager and
 * a rows-per-page choice under it.
 *
 * WHY. A page that lists the 26th to the 100th of anything in one table is seventy-five rows, six phone screens,
 * and the reader came for a place in the ranking.
 *
 * EVERY ROW STAYS IN THE PAGE, AND A STYLE RULE HIDES THE ONES OFF THE CURRENT PAGE. The rows come from a server
 * component, and rows handed across that way can't be copied or re-wrapped here (they arrive as references, so a
 * first version that cloned each row to add a class silently dropped the class and the off-page rows). A rule keyed
 * to the body's id needs nothing from the rows: `nth-child` picks the page. A link in the 80th row is still in the
 * page for a crawler, as it was when the table sat whole inside a fold.
 *
 * THE SERVER DRAWS THE WIDE PAGE. It can't see the screen, so the first page's rule hides past 25 and, in a media
 * rule, past a phone's ten: the phone never paints the long page.
 */
export function PagedTable({
  label,
  caption,
  head,
  rows,
  noun,
  tableClassName,
  boxClassName,
  className,
}: {
  /** What the scrolling box holds, read out when it takes focus. */
  label: string;
  caption?: ReactNode;
  /** The `<thead>`. */
  head: ReactNode;
  /** One `<tr>` a row, each with its key. */
  rows: ReactNode[];
  /** What a row is, plural ("law firms"), for "26 to 50 of 75 law firms". */
  noun: string;
  tableClassName?: string;
  boxClassName?: string;
  className?: string;
}) {
  const top = useRef<HTMLDivElement>(null);
  const bodyId = `paged-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const paged = usePagedRows(rows);
  return (
    <div ref={top} className={cn("scroll-mt-24", className)}>
      <style dangerouslySetInnerHTML={{ __html: pageRule(bodyId, paged.start, paged.perPage, paged.page === 1 && !paged.picked ? paged.narrow : null) }} />
      <ScrollBox label={label} className={boxClassName}>
        <table className={tableClassName}>
          {caption}
          {head}
          <tbody id={bodyId}>{rows}</tbody>
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

/**
 * The rule that leaves one page of a list's children showing: `start` rows are skipped, `size` are shown. With
 * `phone`, the rows past that many are hidden under 640px too (the server's first page, before the screen is known).
 */
export function pageRule(id: string, start: number, size: number, phone: number | null): string {
  const before = start > 0 ? `#${id} > :nth-child(-n+${start}), ` : "";
  const rule = `${before}#${id} > :nth-child(n+${start + size + 1}) { display: none; }`;
  return phone !== null && phone < size
    ? `${rule} @media (max-width: 639px) { #${id} > :nth-child(n+${start + phone + 1}) { display: none; } }`
    : rule;
}
