import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { CaseLookupForm } from "@/components/tools/CaseLookupForm";
import { FinderDock, FinderDockPanel } from "@/components/tools/FinderDock";
import { Figure, FigureRow, type FigureTrend } from "@/components/data/FigureRow";
import { Spark, SplitBar, type SplitPart } from "@/components/data/FigureVisual";

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
  /** The figure over time, oldest first: drawn as a spark line. */
  spark?: readonly number[];
  /** The figure as a share of something: drawn as a split bar, with the sentence that says it. */
  split?: { parts: readonly SplitPart[]; label: string };
}

/**
 * A list page's overview: its summary figures as the site's figure cards, in one even row, each with its small
 * picture where it has one. Its own part, so a page whose search is the list's own form can draw it between that
 * form and the list.
 */
export function IndexFigures({ figures, className }: { figures: IndexFigure[]; className?: string }) {
  if (figures.length === 0) return null;
  return (
    <FigureRow className={className}>
      {figures.map((f) => (
        <Figure
          key={f.label}
          label={f.label}
          value={
            f.href ? (
              <Link href={f.href} className="link">
                {f.value}
              </Link>
            ) : (
              f.value
            )
          }
          visual={
            f.spark && f.spark.length > 1 ? (
              <Spark values={f.spark} />
            ) : f.split ? (
              <SplitBar parts={f.split.parts} label={f.split.label} />
            ) : undefined
          }
          trend={f.trend}
          note={f.note}
        />
      ))}
    </FigureRow>
  );
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
      {/* First things first, in one column at every width: the title, one line on what the list is, the way in,
          then the figures in one even row. Side by side, the title's column and the box's column never ended on the
          same line: one of them always stood over empty space, and the figures broke two and one. */}
      <div className="[&>*]:min-w-0">
        <h1 className="text-balance font-heading text-4xl font-bold leading-tight sm:text-5xl">{wholeCodes(title)}</h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-soft">{lede}</p>{" "}
        {aside ? <div className="mt-6 max-w-3xl">{aside}</div> : null}{" "}
        <IndexFigures figures={figures} className="mt-6" />
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
