import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";

import { pageItems } from "@/lib/pageItems";

/**
 * A pager drawn by the server for a list paged by its address (`?page=3&per=50`): Previous, the page numbers with gaps,
 * Next, and the rows per page. Plain links, so it works before any script runs and every page has its own address.
 * Each control is 44px; the current page and the current size are `aria-current`.
 */
export function ServerPager({
  page,
  pageCount,
  total,
  per,
  perOptions,
  href,
  noun,
  label = "Pages",
}: {
  page: number;
  pageCount: number;
  total: number;
  per: number;
  perOptions: readonly number[];
  /** The address of a page at a size. */
  href: (page: number, per: number) => string;
  /** What the list holds, plural ("receipt numbers"). */
  noun: string;
  label?: string;
}) {
  const first = total ? (page - 1) * per + 1 : 0;
  const last = Math.min(total, page * per);
  const box = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 border-2 px-3 font-semibold";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <p className="text-base">
        {first.toLocaleString("en-US")} to {last.toLocaleString("en-US")} of {total.toLocaleString("en-US")} {noun}
      </p>{" "}
      {pageCount > 1 ? (
        <nav aria-label={label}>
          <ul className="flex flex-wrap items-center gap-2">
            <li>
              {page > 1 ? (
                <Link href={href(page - 1, per)} className={`${box} border-border bg-card`} rel="prev">
                  <CaretLeftIcon aria-hidden="true" weight="bold" className="size-4" />
                  Previous
                </Link>
              ) : null}
            </li>{" "}
            {pageItems(page, pageCount).map((item, i) =>
              item === "gap" ? (
                <li key={`gap-${i}`} aria-hidden="true" className="px-1">
                  &hellip;
                </li>
              ) : (
                <li key={item}>
                  <Link
                    href={href(item, per)}
                    aria-current={item === page ? "page" : undefined}
                    aria-label={`Page ${item}`}
                    className={`${box} ${item === page ? "border-foreground bg-primary text-primary-foreground" : "border-border bg-card"}`}
                  >
                    {item}
                  </Link>
                </li>
              ),
            )}{" "}
            <li>
              {page < pageCount ? (
                <Link href={href(page + 1, per)} className={`${box} border-border bg-card`} rel="next">
                  Next
                  <CaretRightIcon aria-hidden="true" weight="bold" className="size-4" />
                </Link>
              ) : null}
            </li>
          </ul>
        </nav>
      ) : null}{" "}
      {total > (perOptions[0] ?? 0) ? (
        <nav aria-label="Rows per page" className="flex flex-wrap items-center gap-2">
          <span className="text-base">Rows per page</span>{" "}
          {perOptions.map((n) => (
            <Link
              key={n}
              href={href(1, n)}
              aria-current={n === per ? "true" : undefined}
              className={`${box} ${n === per ? "border-foreground bg-primary text-primary-foreground" : "border-border bg-card"}`}
            >
              {n}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
