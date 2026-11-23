"use client";

/**
 * Recent searches in a search box. When a box has focus and nothing is typed in it, a short list under it offers what
 * this visitor searched for lately, each a link back to its answer, with Clear. The list itself is kept by
 * `@/lib/search/recentSearches`, in this browser only.
 *
 * ONE WRAPPER FOR EVERY BOX. `RecentSearchesField` goes around a box's input (server-drawn forms included) and does
 * the rest: it shows the list, keeps a search when one is made, and on a page whose box filters in place it fills the
 * box from a search made on that same page instead of loading the page again. The palettes draw the list in their own
 * rows with `useRecentSearches` and `ClearRecentButton`.
 *
 * WHAT "MADE" MEANS. A box in a form keeps its search when the form is sent ("submit"). A box that filters as you type
 * keeps it when Enter is pressed or focus leaves the box with something typed ("filter"). A box can also only offer
 * the list and keep nothing.
 *
 * KEYBOARD AND SCREEN READERS. Tab reaches Clear and then each search; the down arrow goes from the box into the list
 * and the arrows move through it; Escape closes it. A polite status says how many searches are listed when the list
 * opens, and that they were cleared.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import {
  RECENT_LABEL_MAX,
  clearRecentSearches,
  hrefWithSearch,
  parseRecentSearches,
  pathOf,
  publicSearches,
  readRecentSearchesRaw,
  recentSearchLabel,
  recordSearch,
  subscribeRecentSearches,
  type RecentSearch,
} from "@/lib/search/recentSearches";

/** The list's name, everywhere it's shown. */
export const RECENT_HEADING = "Recent searches";
/** A page's box shows this many, a list short enough to sit above a phone's keyboard. The palettes show every one. */
export const RECENT_SHOWN_IN_A_BOX = 5;

/** "public" leaves out searches that open a page of the signed-in app; "app" shows them all. */
export type RecentScope = "public" | "app";

const noSnapshot = () => null;

/** This visitor's recent searches, newest first, kept up to date with this page and other tabs. */
export function useRecentSearches(scope: RecentScope = "public"): RecentSearch[] {
  const raw = React.useSyncExternalStore(subscribeRecentSearches, readRecentSearchesRaw, noSnapshot);
  return React.useMemo(() => {
    const all = parseRecentSearches(raw);
    return scope === "app" ? all : publicSearches(all);
  }, [raw, scope]);
}

/** "3 recent searches", "1 recent search". */
export function recentSearchCount(n: number): string {
  return `${n} recent ${n === 1 ? "search" : "searches"}`;
}

/** What the status line says once the list is cleared. */
export const RECENT_CLEARED = "Recent searches cleared.";

const CLEAR =
  "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-3 text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * Clear, for every recent list: the visible word, and the whole name for a screen reader. The name starts with the
 * word shown, so a person using speech can say what they see.
 */
export function ClearRecentButton({ onCleared, className }: { onCleared?: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Clear recent searches"
      onClick={() => {
        clearRecentSearches();
        onCleared?.();
      }}
      className={cn(CLEAR, className)}
    >
      Clear
    </button>
  );
}

/**
 * A form's GET address with what it sends: the answer's page, as the browser opens it, with the box's own field
 * holding the search as it's kept (tidied, a case number in its shape) and the empty fields left off.
 */
function formHref(form: HTMLFormElement, input: HTMLInputElement, search: string): string {
  const url = new URL(form.action, window.location.href);
  const sent = new URLSearchParams();
  for (const [name, value] of new FormData(form)) {
    if (typeof value !== "string" || value === "") continue;
    sent.append(name, name === input.name ? search : value);
  }
  url.search = sent.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

const PANEL =
  "absolute inset-x-0 top-full z-50 mt-1 border-2 border-foreground bg-popover text-left text-base font-normal normal-case tracking-normal text-popover-foreground shadow-hard animate-in fade-in-0 duration-150 motion-reduce:animate-none";
const ROW =
  "flex min-h-11 w-full items-center gap-2 px-3 py-2 text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export interface RecentSearchesFieldProps {
  /** The box's input, with anything drawn inside its frame. */
  children: React.ReactNode;
  /** The wrapper's layout, in place of the input's own: it holds the input's place in a row or a grid. */
  className?: string;
  /** When a search made here is kept: "submit" with its form, "filter" on Enter or on leaving the box. Unset keeps none. */
  record?: "submit" | "filter";
  /** The address field that reopens this box's search on its page. */
  field?: string;
  /** The page that answers a search, when it isn't this page with `field` set (or, for "submit", the form's address). */
  hrefFor?: (search: string) => string;
  /** Fill the box with a search and run it, for a search made on this same page. Without it, a pick loads the page. */
  onRestore?: (search: string) => void;
  /** On arrival, fill the box from `field` in the address: for a box whose page doesn't read it already. */
  restoreFromUrl?: boolean;
  /** The box's value, when the page holds it (a clear button can empty it with no typing). */
  value?: string;
  scope?: RecentScope;
}

export function RecentSearchesField({
  children,
  className,
  record,
  field = "q",
  hrefFor,
  onRestore,
  restoreFromUrl = false,
  value,
  scope = "public",
}: RecentSearchesFieldProps) {
  const all = useRecentSearches(scope);
  const searches = React.useMemo(() => all.slice(0, RECENT_SHOWN_IN_A_BOX), [all]);
  const pathname = usePathname();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const headingId = React.useId();
  const [focused, setFocused] = React.useState(false);
  const [typedEmpty, setTypedEmpty] = React.useState(true);
  const [dismissed, setDismissed] = React.useState(false);
  const [cleared, setCleared] = React.useState(false);

  const empty = value !== undefined ? value.trim() === "" : typedEmpty;
  const open = focused && empty && !dismissed && searches.length > 0;
  const said = open ? `${recentSearchCount(searches.length)} below the box.` : cleared ? RECENT_CLEARED : "";

  const box = React.useCallback(() => rootRef.current?.querySelector("input") ?? null, []);

  /** Keep what's in the box as a search, at the page that answers it. */
  const keep = React.useCallback(
    (input: HTMLInputElement | null) => {
      const label = recentSearchLabel(input?.value ?? "");
      if (!input || !label) return;
      const form = record === "submit" ? input.form : null;
      const href = hrefFor
        ? hrefFor(label)
        : form?.getAttribute("action")
          ? formHref(form, input, label)
          : hrefWithSearch(window.location.href, field, label);
      recordSearch({ label, href });
    },
    [hrefFor, field, record],
  );

  const keepOnSubmit = React.useEffectEvent(() => keep(box()));
  React.useEffect(() => {
    if (record !== "submit") return;
    const form = box()?.form;
    if (!form) return;
    const onSubmit = () => keepOnSubmit();
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [record, box]);

  const restoreOnArrival = React.useEffectEvent(() => {
    if (!restoreFromUrl || !onRestore) return;
    const fromUrl = (new URLSearchParams(window.location.search).get(field) ?? "").slice(0, RECENT_LABEL_MAX).trim();
    if (fromUrl) onRestore(fromUrl);
  });
  React.useEffect(() => {
    restoreOnArrival();
  }, []);

  /** A pick moves the search to the top; one made in this box on this page fills the box instead of a page load. */
  const pick = (e: React.MouseEvent<HTMLAnchorElement>, s: RecentSearch) => {
    recordSearch({ label: s.label, href: s.href });
    if (!onRestore) return;
    const target = new URL(s.href, window.location.href);
    const search = target.searchParams.get(field);
    if (target.pathname !== window.location.pathname || !search) return;
    e.preventDefault();
    onRestore(search);
    setTypedEmpty(false);
    box()?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const input = box();
    if (e.key === "Enter" && e.target === input && record === "filter") keep(input);
    if (!open) return;
    if (e.key === "Escape") {
      setDismissed(true);
      if (e.target !== input) input?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const links = [...(rootRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-recent-search]") ?? [])];
    const at = links.indexOf(e.target as HTMLAnchorElement);
    const next = e.target === input ? (e.key === "ArrowDown" ? links[0] : undefined) : at < 0 ? undefined : e.key === "ArrowDown" ? links[at + 1] : at === 0 ? input : links[at - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      onFocus={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(true);
          setDismissed(false);
          setCleared(false);
        }
        if (e.target === box()) setTypedEmpty((e.target as HTMLInputElement).value.trim() === "");
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setFocused(false);
        if (record === "filter") keep(box());
      }}
      onInput={(e) => {
        if (e.target === box()) setTypedEmpty((e.target as HTMLInputElement).value.trim() === "");
      }}
      onKeyDown={onKeyDown}
    >
      {children}{" "}
      {open ? (
        // A press on the list keeps focus in the box, so the box doesn't lose it (and the list close) before the
        // click lands; Safari never moves focus to a link or a button it clicks.
        <div className={PANEL} onMouseDown={(e) => e.preventDefault()}>
          <div className="flex items-center justify-between gap-3 border-b-2 border-border pl-3">
            <p id={headingId} className="text-sm font-semibold text-muted-foreground">
              {RECENT_HEADING}
            </p>{" "}
            <ClearRecentButton
              onCleared={() => {
                setCleared(true);
                // Clear goes with the list: focus returns to the box rather than to nothing.
                box()?.focus();
              }}
            />
          </div>{" "}
          <ul aria-labelledby={headingId}>
            {searches.map((s) => {
              const label = (
                <>
                  <ClockCounterClockwiseIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />{" "}
                  <span className="min-w-0 truncate" translate="no">
                    {s.label}
                  </span>
                </>
              );
              // The same page with another search loads in full, so every box on it starts from the address; any
              // other page is a quick move. Never fetched ahead: the list opens on every focus.
              return (
                <li key={s.href}>
                  {pathOf(s.href) === pathname ? (
                    <a href={s.href} data-recent-search="" onClick={(e) => pick(e, s)} className={ROW}>
                      {label}
                    </a>
                  ) : (
                    <Link href={s.href} prefetch={false} data-recent-search="" onClick={(e) => pick(e, s)} className={ROW}>
                      {label}
                    </Link>
                  )}{" "}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}{" "}
      <span role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
    </div>
  );
}
