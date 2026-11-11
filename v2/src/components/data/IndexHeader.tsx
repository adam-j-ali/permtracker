import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { CaseLookupForm } from "@/components/tools/CaseLookupForm";
import { FinderDock, FinderDockPanel } from "@/components/tools/FinderDock";
import { TrendChip, type FigureTrend } from "@/components/data/FigureRow";

/**
 * The top of a list page: what the list is, its headline figures, and the
 * box that filters it beside them.
 *
 * Most people who open a list of sponsors, firms or jobs came to find one of
 * them, and the search used to sit thousands of pixels down, inside the
 * table's filters. The box here submits to the table's own anchor with `?q=`,
 * which the table reads on load (`queryFromUrl`), so the answer opens already
 * filtered with no script of its own.
 */

/** A form or visa code is one word ("H-2A", "CW-1", "I-140"): a line must never end on its hyphen. */
const CODE = /([A-Z]{1,3}-\d[0-9A-Z]*)/;

/** A heading's words with each code kept whole. Split on a captured group, so the codes are the odd pieces. */
export function wholeCodes(text: string): ReactNode[] {
  return text.split(CODE).map((piece, i) =>
    i % 2 === 1 ? (
      <span key={i} className="whitespace-nowrap">
        {piece}
      </span>
    ) : (
      piece
    ),
  );
}

export interface IndexFigure {
  label: string;
  value: string;
  href?: string;
  note?: string;
  /** How the figure moved, drawn as the cards' chip. */
  trend?: FigureTrend;
}

export function IndexHeader({
  title,
  lede,
  figures = [],
  aside,
  className,
}: {
  title: string;
  lede: ReactNode;
  figures?: IndexFigure[];
  aside?: ReactNode;
  className?: string;
}) {
  return (
    // Two columns by the header's own width, never the screen's: beside the data rail a 1024px screen leaves the
    // title a 256px column, and a heading on four lines.
    <header className={cn("@container pt-8 sm:pt-10", className)}>
      {/* The case box's finder opens in the dock's panel, under both columns: the box is too narrow to hold it. */}
      <FinderDock>
      {/* First things first: the title, the way in, then the figures. On a phone they stack in that order, so the
          box is in the first screen and the figures follow it. Side by side, the title and the figures share the
          left column and the box the right: its top edge meets the top of the heading's capitals (the 9px), and the
          figures stand on the line of its bottom edge whenever the box is the taller of the two. */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 @[52rem]:grid-cols-[minmax(0,1.15fr)_minmax(25rem,1fr)] @[52rem]:grid-rows-[auto_1fr] [&>*]:min-w-0">
        <div className="@[52rem]:col-start-1 @[52rem]:row-start-1">
          <h1 className="text-balance font-heading text-4xl font-bold leading-tight sm:text-5xl">{wholeCodes(title)}</h1>{" "}
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-soft">{lede}</p>
        </div>{" "}
        {aside ? (
          <div className="@[52rem]:col-start-2 @[52rem]:row-span-2 @[52rem]:row-start-1 @[52rem]:mt-[9px] @[52rem]:self-start">{aside}</div>
        ) : null}{" "}
        {figures.length > 0 ? (
          <dl className="flex flex-wrap gap-x-10 gap-y-5 @[52rem]:col-start-1 @[52rem]:row-start-2 @[52rem]:self-end">
            {figures.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-sm font-semibold">{f.label}</dt>{" "}
                <dd className="mt-1 font-heading text-2xl font-bold leading-tight tabular-nums [overflow-wrap:anywhere]">
                  {f.href ? (
                    <Link href={f.href} className="link">
                      {f.value}
                    </Link>
                  ) : (
                    f.value
                  )}
                </dd>{" "}
                {f.trend ? (
                  <>
                    <dd className="mt-1.5">
                      <TrendChip trend={f.trend} />
                    </dd>{" "}
                  </>
                ) : null}
                {f.note ? <dd className="mt-0.5 text-sm text-soft">{f.note}</dd> : null}
              </div>
            ))}
          </dl>
        ) : null}
      </div>{" "}
      <FinderDockPanel className="mt-6" />
      </FinderDock>
    </header>
  );
}

/**
 * A plain GET form into a list's table: no script, so it works before the
 * page's code has loaded, and the address it lands on can be shared. It
 * filters the list it sits on; the header's box is the site-wide search.
 */
export function IndexSearch({
  title,
  action,
  placeholder,
  note,
  footer,
  name = "q",
  button = "Filter",
}: {
  title: string;
  /** The list page and its table's anchor, e.g. "/perm-employers#all", or another page that reads the field. */
  action: string;
  /** The query field the receiving page reads: `q` for a list, `case` for the case page. */
  name?: string;
  button?: string;
  placeholder: string;
  note?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <form method="get" action={action} role="search" className="object p-5 sm:p-6">
      <label htmlFor="index-search" className="font-heading text-xl font-bold leading-tight">
        {title}
      </label>{" "}
      {note ? <p className="mt-1 text-sm leading-relaxed text-soft">{note}</p> : null}{" "}
      <div className="mt-3 flex gap-2">
        <input
          id="index-search"
          name={name}
          type="search"
          required
          minLength={2}
          autoComplete="off"
          placeholder={placeholder}
          className="h-12 min-w-0 flex-1 border-2 border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />{" "}
        <button type="submit" className={buttonVariants({ size: "lg" })}>
          {button}
        </button>
      </div>{" "}
      {footer ? <div className="mt-3 text-sm border-t-2 border-border">{footer}</div> : null}
    </form>
  );
}

/**
 * The case box on a program's list page: the one shared lookup, labelled for
 * that program's numbers, for someone who landed here holding one.
 */
export function IndexLookup({
  title,
  example,
  note,
  source,
  searchHref = "/case-search",
  searchLabel,
  program,
}: {
  title: string;
  /** What this program's numbers look like, said when the typed one is the wrong shape. */
  example: string;
  note?: ReactNode;
  source: string;
  /** The kind of filing this list is of: the finder under the box opens on it. */
  program?: "perm" | "pwd" | "lca" | "seasonal";
  searchHref?: string;
  searchLabel?: string;
}) {
  return (
    <div className="object p-5 sm:p-6">
      <CaseLookupForm
        label={title}
        example={example}
        help={note ?? null}
        source={source}
        searchHref={searchHref}
        finderProgram={program}
        boxed
        // Left out, the box says its own words for the full search. This is a server file, so it
        // can't read a constant out of the box's browser-side module.
        {...(searchLabel ? { searchLabel } : {})}
      />
    </div>
  );
}
