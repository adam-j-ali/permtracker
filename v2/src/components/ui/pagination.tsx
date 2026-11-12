"use client";

import { useCallback, useSyncExternalStore, type RefObject } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";

import { choiceVariants } from "@/components/ui/choice";
import { ChoiceRow } from "@/components/ui/choice-row";
import { cn } from "@/lib/utils";

/**
 * Numbered pages for a list held in full on the page (articles, a letter of names, notices). Owner, Oct 21 2026:
 * "pagination not endless scroll ... check any and everywhere proper ... good looking good working smooth".
 *
 * - The page lives in the address (`?page=3`), so a reload, a shared link and the Back button all land on it.
 *   The server renders page 1; the browser moves to the address's page as it starts.
 * - Previous, the page numbers with gaps, Next. On a phone, Previous, "Page 3 of 8" and Next.
 * - A press brings the top of the list back into view when it has scrolled out above, as Pager does.
 * - Each control is 44px and says what it does to a screen reader; the current page is `aria-current`.
 *
 * Lists paged by the server with a cursor (the case browsers) keep Pager: a cursor can't jump to page 7.
 */

/** The page numbers to draw, 1-based, with "gap" where a run is skipped. Seven slots at most. */
export function pageItems(page: number, count: number): Array<number | "gap"> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "gap", count];
  if (page >= count - 3) return [1, "gap", count - 4, count - 3, count - 2, count - 1, count];
  return [1, "gap", page - 1, page, page + 1, "gap", count];
}

/** Clamp a page number read from anywhere to 1..count. */
export function clampPage(page: number, count: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, count));
}

const CHANGE = "pt:pagechange";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}

/**
 * Some of the address's query (`?page=3&topic=queue`), read without useSearchParams so a prerendered page stays
 * whole. Server and first paint read nothing, so the prerendered HTML is the default view and hydration never
 * mismatches; the address's view follows at once. `update` changes several keys in one history entry (null removes).
 */
export function useQueryParam(key: string): [string, (updates: Record<string, string | null>) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(key) ?? "",
    () => "",
  );
  const update = useCallback((updates: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    if (url.href !== window.location.href) window.history.pushState(window.history.state, "", url.href);
    window.dispatchEvent(new Event(CHANGE));
  }, []);
  return [raw, update];
}

/** The page in the address, 1 when absent (see useQueryParam). */
export function usePageParam(key = "page"): [number, (page: number) => void] {
  const [raw, update] = useQueryParam(key);
  const page = Number(raw) >= 1 ? Math.floor(Number(raw)) : 1;
  const set = useCallback((next: number) => update({ [key]: next <= 1 ? null : String(next) }), [key, update]);
  return [page, set];
}

/**
 * How many rows a page of a list holds: fewer on a phone, and the reader's own choice once they make one. Every
 * list shows a page sized for the screen, with a pager and this choice (a standing rule since Nov 11 2026).
 *
 * - With nothing chosen, a wide screen gets `wide` rows and a phone `narrow`: a row that is one line on a desktop
 *   is three or four on a phone, and 25 of them ran five screens.
 * - A choice lives in the address (`?per=50`), so a reload and a shared link keep it. Choosing starts the list
 *   from its first page.
 * - The server can't know the screen, so it renders `wide` rows. A host hides the rows past `narrow` on a phone
 *   with `narrowHidden(i)` until the browser has started, and nothing jumps: the phone never paints the long page.
 */
export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
const NARROW = "(max-width: 639px)";

function subscribeNarrow(onChange: () => void) {
  const m = window.matchMedia?.(NARROW);
  if (!m) return () => {};
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

/** Whether the screen is a phone's width. False on the server and for the first paint, so markup matches. */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia?.(NARROW).matches ?? false,
    () => false,
  );
}

/** The class that hides a server-rendered row a phone's shorter page leaves out, until the browser has started. */
export const NARROW_HIDDEN = "max-sm:hidden";

export interface PerPage {
  /** Rows on a page, now. */
  per: number;
  /** The reader picked this (it's in the address); false while it's the screen's default. */
  chosen: boolean;
  setPer: (per: number) => void;
  options: readonly number[];
  /** The class for row `i` (0-based) of a server-rendered page: hides the rows a phone's shorter page leaves out. */
  narrowHidden: (i: number) => string | undefined;
}

export function usePerPage({
  wide = 25,
  narrow = 10,
  options = PER_PAGE_OPTIONS,
  key = "per",
  pageKey = "page",
  address,
}: {
  wide?: number;
  narrow?: number;
  options?: readonly number[];
  key?: string;
  pageKey?: string;
  /** For a list that already keeps its picks in the address through Next's hooks: its own value and writer. */
  address?: { raw: string; update: (updates: Record<string, string | null>) => void };
} = {}): PerPage {
  const own = useQueryParam(key);
  const raw = address ? address.raw : own[0];
  const update = address ? address.update : own[1];
  const isNarrow = useNarrowScreen();
  const asked = options.includes(Number(raw)) ? Number(raw) : null;
  const setPer = useCallback((per: number) => update({ [key]: String(per), [pageKey]: null }), [key, pageKey, update]);
  return {
    per: asked ?? (isNarrow ? narrow : wide),
    chosen: asked !== null,
    setPer,
    options,
    narrowHidden: (i) => (asked === null && i >= narrow ? NARROW_HIDDEN : undefined),
  };
}

/** Bring a list's top into view if a press left it above the screen. */
export function showTop(top: HTMLElement | null | undefined) {
  if (!top || top.getBoundingClientRect().top >= 0) return;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  top.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
}

export function Pagination({
  page,
  pageCount,
  onPage,
  total,
  perPage,
  noun = "items",
  label = "Pages",
  scrollTo,
  per,
  className,
}: {
  /** 1-based. */
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  /** How many items the list holds, for "13 to 24 of 86". */
  total?: number;
  perPage?: number;
  /** What the list holds, plural ("guides"). */
  noun?: string;
  /** The nav's accessible name, when a page has two paged lists. */
  label?: string;
  /** The top of the list; give it a `scroll-mt-*` clear of the header. */
  scrollTo?: RefObject<HTMLElement | null>;
  /** With it, the pager offers "Rows per page" (usePerPage). Left out where the list has fewer rows than the smallest page. */
  per?: Pick<PerPage, "per" | "setPer" | "options">;
  className?: string;
}) {
  // The choice is offered whenever the list is longer than the smallest page, on one page or many: someone who
  // picked 100 and got everything on one page still needs the way back.
  const smallest = per ? Math.min(...per.options) : 0;
  const rowsChoice =
    per && total !== undefined && total > smallest ? (
      <ChoiceRow
        label="Rows per page"
        labelClassName="block text-center text-sm text-muted-foreground"
        rowClassName="justify-center"
        options={per.options.map((n) => ({ value: String(n), label: String(n), ariaLabel: `${n} rows per page` }))}
        value={String(per.per)}
        onChange={(v) => {
          per.setPer(Number(v));
          showTop(scrollTo?.current);
        }}
      />
    ) : null;
  if (pageCount <= 1) {
    return total && total > 0 ? (
      <div className={cn("flex flex-col items-center gap-3", className)}>
        <p className="text-sm text-muted-foreground">{`All ${total.toLocaleString("en-US")} ${noun}`}</p> {rowsChoice}
      </div>
    ) : null;
  }
  const go = (next: number) => {
    if (next === page || next < 1 || next > pageCount) return;
    onPage(next);
    showTop(scrollTo?.current);
  };
  const from = total !== undefined && perPage ? (page - 1) * perPage + 1 : null;
  const to = from !== null && total !== undefined && perPage ? Math.min(total, page * perPage) : null;
  const button = (on: boolean) => cn(choiceVariants({ on }), "min-w-11 px-3 tabular-nums");
  return (
    <nav aria-label={label} className={cn("flex flex-col items-center gap-3", className)}>
      {from !== null && to !== null && total !== undefined ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {`${from.toLocaleString("en-US")} to ${to.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${noun}`}
        </p>
      ) : null}{" "}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className={cn(button(false), "gap-1.5")}
        >
          <CaretLeftIcon aria-hidden="true" weight="bold" className="size-4" />
          <span className="hidden sm:inline">Previous</span>
        </button>{" "}
        <span className="text-sm font-semibold tabular-nums sm:hidden">{`Page ${page} of ${pageCount}`}</span>{" "}
        <ul className="hidden items-center gap-2 sm:flex">
          {pageItems(page, pageCount).map((item, i) =>
            item === "gap" ? (
              <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted-foreground">
                …
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => go(item)}
                  aria-current={item === page ? "page" : undefined}
                  aria-label={item === page ? `Page ${item}, this page` : `Page ${item}`}
                  className={button(item === page)}
                >
                  {item}
                </button>
              </li>
            ),
          )}
        </ul>{" "}
        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
          className={cn(button(false), "gap-1.5")}
        >
          <span className="hidden sm:inline">Next</span>
          <CaretRightIcon aria-hidden="true" weight="bold" className="size-4" />
        </button>
      </div>{" "}
      {rowsChoice}
    </nav>
  );
}
