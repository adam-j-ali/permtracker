"use client";

/**
 * The signed-in app's one search box: your own cases first (case number with
 * or without dashes, employer, worker or job), then the app's pages, then the
 * public data. Opened from the header's box or with Cmd+K / Ctrl+K.
 *
 * The cases come from the case list's own query, so the box matches exactly
 * what the cases page's search would (one matcher, `convex/lib/fuzzy.ts`).
 * Loaded on the first open, so no signed-in page ships it until it's used.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { Command } from "cmdk";
import { ClockCounterClockwiseIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";

import { api } from "@convex/_generated/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fuzzyScore } from "@/lib/fuzzy";
import { normaliseCaseNumber } from "@/lib/caseNumberShape";
import { formatProgressStatus } from "@convex/lib/notificationHelpers";
import { caseSearchHref } from "@/lib/caseSearchPlan";
import { recordSearch } from "@/lib/search/recentSearches";
import { ClearRecentButton, RECENT_CLEARED, RECENT_HEADING, recentSearchCount, useRecentSearches } from "@/components/search/RecentSearches";
import { caseSubtitle, caseTitle } from "@convex/lib/caseLabel";

/** Cases shown in the box; the cases page holds every match. */
const CASES_SHOWN = 8;
/** Below this many letters a search would match nearly everything. */
const MIN_QUERY = 2;
const PAGE_MATCH_MIN = 0.6;

const APP_PAGES = [
  { href: "/dashboard", name: "Dashboard" },
  { href: "/cases", name: "Cases" },
  { href: "/cases/new", name: "Add a case" },
  { href: "/calendar", name: "Calendar" },
  { href: "/timeline", name: "Timeline" },
  { href: "/notifications", name: "Notifications" },
  { href: "/settings", name: "Settings" },
] as const;

const ROW = "flex min-h-11 cursor-pointer items-baseline justify-between gap-3 px-3 py-2.5 text-base data-[selected=true]:bg-accent";
const GROUP =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground";
/** The recent searches' heading: a full 44px row, so Clear sits beside it at its own height. */
const RECENT_GROUP =
  "[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:min-h-11 [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground";

export function AppSearchPalette({
  open,
  onOpenChange,
  onReady,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the palette's code has loaded, so the header button can stop its spinner. */
  onReady?: () => void;
}) {
  React.useEffect(() => {
    onReady?.();
  }, [onReady]);
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const q = query.trim();
  const searching = q.length >= MIN_QUERY;

  const result = useQuery(
    api.cases.listFiltered,
    open && searching ? { searchQuery: q, pageSize: CASES_SHOWN, page: 1 } : "skip",
  );

  const pages = q
    ? APP_PAGES.filter((p) => fuzzyScore(q, p.name) >= PAGE_MATCH_MIN)
    : APP_PAGES;
  const caseNumber = normaliseCaseNumber(q);

  // Every recent search, the app's own pages included; signing out clears them (AuthContext.beginSignOut). A move
  // made with nothing typed isn't a search, so `go` keeps one only when it's handed one.
  const recents = useRecentSearches("app");
  const showRecents = !q && recents.length > 0;
  const [recentsCleared, setRecentsCleared] = React.useState(false);
  React.useEffect(() => {
    if (!open) setRecentsCleared(false);
  }, [open]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function go(href: string, search?: string | null) {
    if (search) recordSearch({ label: search, href });
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[12vh] translate-y-0 gap-0 p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search your cases</DialogTitle>
        <Command shouldFilter={false} label="Search your cases" className="text-foreground">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Command.Input
              ref={inputRef}
              autoFocus
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                setRecentsCleared(false);
              }}
              placeholder="Case number or name"
              className="min-h-[52px] w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </div>
          <p aria-live="polite" aria-atomic="true" className="sr-only">
            {showRecents ? `${recentSearchCount(recents.length)}.` : recentsCleared ? RECENT_CLEARED : ""}
          </p>
          <Command.List className="max-h-[60vh] overflow-y-auto pb-2">
            {showRecents && (
              // Clear sits outside the group, whose heading cmdk hides from screen readers.
              <div className="relative">
                <Command.Group heading={RECENT_HEADING} className={RECENT_GROUP}>
                  {recents.map((r) => (
                    <Command.Item key={r.href} value={`recent-${r.href}`} onSelect={() => go(r.href, r.label)} className={ROW}>
                      <span className="flex min-w-0 items-center gap-2">
                        <ClockCounterClockwiseIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />{" "}
                        <span className="min-w-0 truncate" translate="no">
                          {r.label}
                        </span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>{" "}
                <ClearRecentButton
                  className="absolute right-0 top-0"
                  onCleared={() => {
                    setRecentsCleared(true);
                    inputRef.current?.focus();
                  }}
                />
              </div>
            )}
            {searching && (
              <Command.Group heading="Your cases" className={GROUP}>
                {result === undefined ? (
                  <p className="px-3 py-2.5 text-sm text-muted-foreground">Searching your cases...</p>
                ) : result.cases.length === 0 ? (
                  <p className="px-3 py-2.5 text-sm text-muted-foreground">None of your cases match.</p>
                ) : (
                  <>
                    {result.cases.map((c) => (
                      <Command.Item key={c._id} value={`case-${c._id}`} onSelect={() => go(`/cases/${c._id}`, caseTitle(c))} className={ROW}>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{caseTitle(c)}</span>{" "}
                          <span className="block truncate text-sm text-muted-foreground">
                            {caseSubtitle(c)}
                          </span>
                        </span>{" "}
                        <span className="shrink-0 text-sm text-muted-foreground">{formatProgressStatus(c.progressStatus)}</span>
                      </Command.Item>
                    ))}
                    {result.pagination.totalCount > result.cases.length && (
                      <Command.Item
                        value="all-matching-cases"
                        onSelect={() => go(`/cases?search=${encodeURIComponent(q)}`, q)}
                        className={ROW}
                      >
                        Every match on the cases page ({result.pagination.totalCount.toLocaleString()})
                      </Command.Item>
                    )}
                  </>
                )}
              </Command.Group>
            )}

            {pages.length > 0 && (
              <Command.Group heading="Go to" className={GROUP}>
                {pages.map((p) => (
                  <Command.Item key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href, q ? p.name : null)} className={ROW}>
                    {p.name}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {searching && (
              <Command.Group heading="Public data" className={GROUP}>
                {caseNumber ? (
                  <Command.Item
                    value="dol-case-status"
                    onSelect={() => go(`/perm-case-status?case=${encodeURIComponent(caseNumber)}`, caseNumber)}
                    className={ROW}
                  >
                    DOL&apos;s status for {caseNumber}
                  </Command.Item>
                ) : (
                  <Command.Item
                    value="every-filing"
                    onSelect={() => go(caseSearchHref({ q }), q)}
                    className={ROW}
                  >
                    Every public filing for &ldquo;{q}&rdquo;
                  </Command.Item>
                )}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export default AppSearchPalette;
