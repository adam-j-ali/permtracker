"use client";

/**
 * The site-wide search palette: pages, tools, articles, and the live
 * employer / law-firm / occupation lookup, in one box.
 *
 * WHY IT EXISTS. The public surface is ~21,000 URLs deep and the tab strip
 * that navigates it is 15 flat chips; three different per-page search
 * patterns existed and nothing searched across them. This is the one box.
 *
 * A CASE NUMBER IS THE HIGHEST-INTENT QUERY and it is detected by SHAPE:
 * type one and the first action is the case-status lookup, exactly where the
 * hero's form goes. A "YYYY-MM" month routes to the timeline calculator's
 * prefill. Everything else is matched client-side against the page index,
 * the consulates, the job titles, the cities and the articles, while the
 * entity lookup queries the same `?q=` endpoint the index pages use,
 * debounced, three kinds in parallel.
 *
 * THE ORDER IS WORKED OUT HERE, NOT BY CMDK (D14): `rankGroups`
 * (lib/search/paletteRank.ts) scores every row (an exact name, then the words
 * at a word's start, then inside one, then the keywords, then a near
 * spelling), puts each group where its best row puts it, and cmdk is handed
 * the rows in that order with its own filter off. cmdk 1.1.1 could not move a
 * group whose name has a space, so an exact page name could sit sixth.
 *
 * Mounted lazily by SiteSearch (dynamic import on first open), so the public
 * pages ship none of this until someone asks for it.
 */

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Command } from "cmdk";
import { CircleNotchIcon, ClockCounterClockwiseIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";

import { staticIndex } from "@/lib/search/siteIndex";
import { useArticles } from "@/lib/search/articleList";
import { useCities } from "@/lib/search/cityList";
import { useConsulates } from "@/lib/search/consulateList";
import { rankGroups, type RankGroup, type Rankable } from "@/lib/search/paletteRank";
import { socTitleLabel, useSocTitles } from "@/lib/search/socTitleList";
import { GROUPS } from "@/lib/siteMap";
import { useNameSuggestions } from "@/components/search/DidYouMean";
import { KIND_NOUN } from "@/lib/search/suggestTypes";
// The palette carried a byte-identical copy of this regex pair. One rule,
// one module: `caseNumberShape` is the client-side wide form (G- and A-, and
// by shape the P- and I- numbers that share the current layout).
import { normaliseCaseNumber } from "@/lib/caseNumberShape";
import { looksLikeReceipt, normaliseReceipt } from "@/lib/uscis/receipt";
import type { EntityPayload } from "@/lib/entityPayload";
import { trackPaletteSelected, trackSearchMiss } from "@/lib/funnelEvents";
import { SEARCH_TEXT_MAX } from "@/lib/search/limits";
import { caseSearchHref } from "@/lib/caseSearchPlan";
import { entityHref } from "@/lib/entityPayload";
import { recordSearch } from "@/lib/search/recentSearches";
import { ClearRecentButton, RECENT_CLEARED, RECENT_HEADING, recentSearchCount, useRecentSearches } from "@/components/search/RecentSearches";
import { keepWhole } from "@/components/ui/keep-whole";

export interface SearchArticle {
  title: string;
  href: string;
  kind: string;
}

interface EntityHit {
  name: string;
  href: string;
  total: number;
  kindLabel: string;
  /** "See every match" row: the kind's index page, filtered by the query. */
  more?: boolean;
}

/** A bare "YYYY-MM" reads as a filing month. */
function looksLikeMonth(q: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(q.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const mo = Number(m[2]);
  return year >= 2020 && year <= 2035 && mo >= 1 && mo <= 12 ? m[0] : null;
}

const ENTITY_KINDS = [
  { kind: "employer", base: "/perm-employers", label: "Employer", plural: "employers" },
  { kind: "attorney", base: "/perm-attorneys", label: "Law firm", plural: "law firms" },
  { kind: "occupation", base: "/perm-wages", label: "Occupation", plural: "occupations" },
] as const;

/** One row of the palette's matched groups, ranked by `rankGroups`. */
interface PaletteRow extends Rankable {
  /** cmdk's value for the row: one per row, so the row the keys are on is never two. */
  id: string;
  href: string;
  /** What the row says. */
  label: string;
  /** A short note at the row's end: an article's kind, a name's kind and cases. */
  note?: string;
  /** Typed text a program name runs through (keepWhole); a name DOL prints is shown as printed. */
  whole?: boolean;
  /** Picking it keeps what was typed among recent searches, not the row's label ("Every employer matching ..."). */
  keepsQuery?: boolean;
}

/**
 * Between two groups whose best rows match alike: the site's own pages and consulates first, then the names in
 * DOL's data, then the job titles and cities, then the articles, then the guesses at a name.
 */
const PRIORITY = { pages: 4, data: 3, lists: 2, articles: 1, guesses: 0 } as const;
/** Rows a long list (the job titles, the cities) shows at most, as the name lookup shows five of each kind. */
const LIST_ROWS = 5;

/** One look for the palette's rows: a quiet grey for the row the keys are on. */
const ROW = "flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2.5 text-base data-[selected=true]:bg-accent";
/** A row that acts on what was typed (a case number, a month, every filing). */
const ACTION_ROW = "cursor-pointer border-l-2 border-primary-text bg-tint px-3 py-3 text-base font-semibold data-[selected=true]:bg-accent";
const GROUP_HEADING = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground";
/** The recent searches' heading: a full 44px row, so Clear sits beside it at its own height. */
const RECENT_GROUP =
  "[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:min-h-11 [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground";
/** The page groups, in the order the Data menu has them. */
const PAGE_GROUPS = ["Go to", ...GROUPS, "Learn"] as const;

/**
 * Every group the index files a page under, in the menu's order, the index's own groups (USCIS offices, form pages,
 * review stages) before Learn. Until Nov 25 2026 only PAGE_GROUPS rendered, so those pages were in the index and never
 * shown: "hartford field office" found no office.
 */
function groupsOf(pages: readonly { group: string }[]): string[] {
  const used = [...new Set(pages.map((p) => p.group))];
  const known = new Set<string>(PAGE_GROUPS);
  const head = PAGE_GROUPS.filter((g) => g !== "Learn" && used.includes(g));
  const extra = used.filter((g) => !known.has(g));
  return [...head, ...extra, ...(used.includes("Learn") ? ["Learn"] : [])];
}

/** Rows per kind in the palette. The route says whether more match. */
const PALETTE_PER_KIND = 5;

export function SearchPalette({
  open,
  onOpenChange,
  onReady,
  initialQuery = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired once this module has mounted, so the trigger can stop spinning. */
  onReady?: () => void;
  /** What was already typed in the header's box when the palette opened. */
  initialQuery?: string;
}) {
  const router = useRouter();
  // Fetched the first time the palette opens and kept for the visit; the page
  // itself no longer carries the list (src/app/articles.json).
  const { articles, failed: articlesFailed, ready: articlesReady } = useArticles(true);
  // Every consulate with a page (/consulates.json, Batch 5): listed once something is typed, matched like the pages.
  const { list: consulates, failed: consulatesFailed, ready: consulatesReady } = useConsulates(open);
  // Every job title page (/soc-titles.json) and every city page (/cities.json), the same way.
  const { list: socTitles, failed: titlesFailed, ready: titlesReady } = useSocTitles(open);
  const { list: cities, failed: citiesFailed, ready: citiesReady } = useCities(open);
  const pathname = usePathname();
  const [query, setQuery] = React.useState(initialQuery);
  // Each opening starts from what the box held at that moment.
  const [openedWith, setOpenedWith] = React.useState<string | null>(null);
  if (open && openedWith !== initialQuery) {
    setOpenedWith(initialQuery);
    setQuery(initialQuery);
  }
  if (!open && openedWith !== null) setOpenedWith(null);
  const [entityHits, setEntityHits] = React.useState<EntityHit[]>([]);
  const [searchingEntities, setSearchingEntities] = React.useState(false);
  // A FAILED LOOKUP IS NOT AN EMPTY ONE. Each kind used to `catch { return [] }`
  // on its own, so a dead network, a 500 and "no such employer" all rendered as
  // "Nothing matches" - the interface confidently reporting an answer it never
  // got. The count of kinds that threw is kept so the box can say which it is.
  const [entityError, setEntityError] = React.useState(false);
  // The query the name lookup last answered for, so an answer is never read as the answer to what's typed now.
  const [entityFor, setEntityFor] = React.useState<string | null>(null);

  // This module is loaded on the first open, so the trigger has been showing a
  // spinner since the click. Mounting is the moment that ends.
  React.useEffect(() => {
    onReady?.();
  }, [onReady]);

  // Inline arrow, not a bare `staticIndex` reference: `react-hooks/use-memo`
  // requires the first argument to be an inline function expression so the
  // compiler can see the computation it is memoizing. Behaviour is identical,
  // staticIndex takes no arguments.
  const pages = React.useMemo(() => staticIndex(), []);
  const pageGroups = React.useMemo(() => groupsOf(pages), [pages]);
  const caseNumber = normaliseCaseNumber(query);
  // A USCIS receipt typed here goes to its own page, which reads it and saves it in this browser (Nov 25 2026).
  const receipt = caseNumber ? null : normaliseReceipt(query);
  // A receipt half typed is still nobody's name: never sent to the name search.
  const receiptish = !caseNumber && looksLikeReceipt(query);
  const month = looksLikeMonth(query);
  // The closest employer, firm and occupation names, asked for only once the
  // exact lookup has come back with none.
  const { suggestions, loading: suggesting, settled: suggestionsSettled } = useNameSuggestions(
    "all",
    query,
    !caseNumber && !receiptish && !month && !searchingEntities && !entityError && entityHits.length === 0 && query.trim().length >= 3,
  );

  /**
   * Going somewhere, with the palette staying up until it arrives.
   *
   * IT USED TO CLOSE FIRST AND PUSH SECOND. Every destination here is a real
   * navigation and several are slow (`/perm-case-status` asks DOL live and has
   * been measured at ~3.5s; an employer page is a cold server render), so the
   * reader pressed Enter, the palette vanished, and the page they were already
   * on sat there unchanged for seconds with nothing to say it had heard them.
   * That is the reported bug in its purest form: a click, then nothing.
   *
   * `startTransition` gives the pending flag React already has for this, and
   * the palette closes itself when the transition settles - whether that ends
   * on a new route or not, so a push that goes nowhere cannot strand it open.
   */
  const [navPending, startNav] = React.useTransition();
  const [navTarget, setNavTarget] = React.useState<string | null>(null);

  // What this visitor searched for lately, offered while nothing is typed. A pick from the list made with nothing
  // typed is a move, not a search, so `go` keeps a search only when it's handed one.
  const recents = useRecentSearches("public");
  const showRecents = query.trim() === "" && recents.length > 0;
  const [recentsCleared, setRecentsCleared] = React.useState(false);
  React.useEffect(() => {
    if (!open) setRecentsCleared(false);
  }, [open]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const go = React.useCallback(
    (href: string, label: string, search?: string | null) => {
      if (search) recordSearch({ label: search, href });
      trackPaletteSelected(href);
      setNavTarget(label);
      startNav(() => {
        router.push(href);
      });
    },
    [router],
  );

  React.useEffect(() => {
    if (navTarget === null || navPending) return;
    setNavTarget(null);
    setQuery("");
    onOpenChange(false);
  }, [navTarget, navPending, onOpenChange, pathname]);

  // Entity lookup, debounced. Three kinds in parallel against the same
  // cached `?q=` route the index pages use.
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2 || caseNumber || receiptish || month) {
      setEntityHits([]);
      // `setSearchingEntities(false)` HAS TO BE ON THIS PATH TOO. It was not,
      // and the flag is only ever set true by the branch below - so typing
      // "abc" and then deleting a character took the early return with the
      // flag still true, and the box said "Searching the corpus..." for the
      // rest of the session with nothing in flight. A stuck spinner is worse
      // than no spinner: it is a claim that never becomes false.
      setSearchingEntities(false);
      setEntityError(false);
      setEntityFor(null);
      return;
    }
    let cancelled = false;
    setSearchingEntities(true);
    const t = setTimeout(async () => {
      const results = await Promise.all(
        ENTITY_KINDS.map(async ({ kind, base, label, plural }) => {
          try {
            const needle = q.slice(0, SEARCH_TEXT_MAX);
            const res = await fetch(
              `/api/perm-entities/${kind}?q=${encodeURIComponent(needle)}&limit=${PALETTE_PER_KIND}`,
            );
            if (!res.ok) return { rows: [] as EntityHit[], failed: true };
            const payload = (await res.json()) as EntityPayload;
            // A row without a slug has no page: String(null) would link "/null".
            const rows: EntityHit[] = payload.rows
              .slice(0, PALETTE_PER_KIND)
              .filter((r) => typeof r[0] === "string" && r[0] !== "")
              .map((r) => ({
                name: String(r[1]),
                href: `${base}/${String(r[0])}`,
                total: Number(r[3]) || 0,
                kindLabel: label,
              }));
            // Employers DOL hasn't published yet (23% of the employers held).
            // They were in the answer and the palette dropped them.
            for (const h of (payload.live ?? []).slice(0, 3)) {
              if (!h.slug) continue;
              rows.push({
                name: h.name,
                href: entityHref("employer", h.slug),
                total: h.cases,
                kindLabel: "Employer, not published yet",
              });
            }
            if (payload.more || payload.liveMore) {
              rows.push({
                name: `Every ${plural.replace(/s$/, "")} matching \u201c${needle}\u201d`,
                href: `${base}?q=${encodeURIComponent(needle)}`,
                total: 0,
                kindLabel: label,
                more: true,
              });
            }
            return { rows, failed: false };
          } catch {
            return { rows: [] as EntityHit[], failed: true };
          }
        }),
      );
      if (!cancelled) {
        const rows = results.flatMap((r) => r.rows);
        setEntityHits(rows);
        // Only when EVERY kind failed. One kind erroring while the others
        // answer is a partial result, not an outage, and saying "the search
        // did not load" over a list of hits would be its own lie.
        setEntityError(rows.length === 0 && results.every((r) => r.failed));
        setSearchingEntities(false);
        setEntityFor(q);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open, caseNumber, receiptish, month]);

  // Escape closes, Tab stays inside, and focus goes back where it came from.
  //
  // THE COMMENT THIS REPLACES SAID THE DIALOG ELEMENT HANDLED CONTAINMENT.
  // There is no dialog element: this is a plain `<div>` over the page, so Tab
  // walked straight out of the palette into the header and the article behind
  // it while the overlay stayed up - every one of those stops invisible under
  // the scrim. Keyboard operability is a floor here, not a nicety.
  const panelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      // cmdk keeps selection on the input and moves it with the arrow keys, so
      // in practice there are one or two stops; the wrap still has to exist or
      // the second Tab leaves.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnTo?.focus?.();
    };
  }, [open, onOpenChange]);

  // Every row the matched groups can hold, built once per list, so the ranking's normalised names are kept between keys.
  const pageGroupRows = React.useMemo(
    () =>
      pageGroups.map((group) => ({
        group,
        rows: pages
          .filter((p) => p.group === group)
          .map((p): PaletteRow & { main?: boolean } => ({
            id: `page ${p.href}`,
            href: p.href,
            label: p.label,
            name: p.label,
            keywords: p.keywords,
            whole: true,
            ...(p.aliases ? { aliases: p.aliases } : {}),
            ...(p.main ? { main: true } : {}),
          })),
      })),
    [pages, pageGroups],
  );
  const consulateRows = React.useMemo(
    () => consulates.map((c): PaletteRow => ({ id: `consulate ${c.href}`, href: c.href, label: c.label, name: c.label, keywords: c.keywords, whole: true })),
    [consulates],
  );
  const titleRows = React.useMemo(
    () =>
      socTitles.map((t): PaletteRow => ({ id: `title ${t.href}`, href: t.href, label: socTitleLabel(t), name: t.title, keywords: t.code ?? "", whole: true })),
    [socTitles],
  );
  const cityRows = React.useMemo(
    () => cities.map((c): PaletteRow => ({ id: `city ${c.href}`, href: c.href, label: c.label, name: c.label, keywords: c.keywords })),
    [cities],
  );
  const articleRows = React.useMemo(
    () =>
      articles.map((a): PaletteRow => ({ id: `article ${a.href}`, href: a.href, label: a.title, name: a.title, keywords: a.kind, note: a.kind, whole: true })),
    [articles],
  );
  const entityRows = React.useMemo(
    () =>
      entityHits.map(
        (h): PaletteRow => ({
          id: `data ${h.href}`,
          href: h.href,
          label: h.name,
          name: h.name,
          note: h.more ? "More than fit here" : `${h.kindLabel} · ${h.total.toLocaleString("en-US")} ${h.total === 1 ? "case" : "cases"}`,
          // "Every employer matching ..." says the query back: shown, never what places the group.
          ...(h.more ? { unranked: true, keepsQuery: true } : {}),
        }),
      ),
    [entityHits],
  );
  const suggestionRows = React.useMemo(
    () =>
      suggestions.map(
        (h): PaletteRow => ({
          id: `suggest ${h.href}`,
          href: h.href,
          label: h.name,
          name: h.name,
          note: `${KIND_NOUN[h.kind]} · ${h.cases.toLocaleString("en-US")} ${h.cases === 1 ? "case" : "cases"}`,
        }),
      ),
    [suggestions],
  );

  const typed = query.trim();
  // Ranking about 7,700 rows takes 3 to 20 ms a key on a fast laptop and several times that on a phone, so it
  // follows the box at React's low priority: the letters show the moment they're typed, the list a beat later.
  const ranked = React.useDeferredValue(typed);
  // Before anything is typed: the main jobs in the menu's groups, then the articles, in their own order.
  // Once something is: every group ranked, the best group first.
  const shown = React.useMemo((): { heading: string; rows: PaletteRow[] }[] => {
    if (ranked === "") {
      return [
        ...pageGroupRows.map(({ group, rows }) => ({ heading: group, rows: rows.filter((r) => r.main) })),
        { heading: "Articles", rows: articleRows },
      ].filter((g) => g.rows.length > 0);
    }
    const groups: RankGroup<PaletteRow>[] = [
      // Kept on the list whatever the ranking says: the closest names to a search that matched none exactly.
      { heading: "Did you mean", rows: suggestionRows, priority: PRIORITY.guesses, given: true },
      // The lookup's answer to what's typed, in its own order. While the next answer is on its way, the last one's
      // names stay only where they still match.
      { heading: "In the data", rows: entityRows, priority: PRIORITY.data, given: entityFor === ranked },
      ...pageGroupRows.map(({ group, rows }) => ({ heading: group, rows, priority: PRIORITY.pages })),
      { heading: "Consulates", rows: consulateRows, priority: PRIORITY.pages },
      { heading: "Job titles", rows: titleRows, priority: PRIORITY.lists, limit: LIST_ROWS, longList: true },
      { heading: "Cities", rows: cityRows, priority: PRIORITY.lists, limit: LIST_ROWS, longList: true },
      { heading: "Articles", rows: articleRows, priority: PRIORITY.articles },
    ];
    return rankGroups(ranked, groups);
  }, [ranked, pageGroupRows, articleRows, suggestionRows, entityRows, entityFor, consulateRows, titleRows, cityRows]);

  // The row the keys are on follows the best match: when an answer arriving later (the name lookup, a list) puts a
  // new row first, Enter opens that one, not whatever was first a moment before.
  const actionId = caseNumber ? `case ${caseNumber}` : receipt ? `receipt ${receipt}` : month ? `month ${month}` : null;
  const allResultsId = !caseNumber && !month && typed.length >= 2 ? `all programs ${typed}` : null;
  const topId = actionId ?? (showRecents ? `recent ${recents[0]!.href}` : (shown[0]?.rows[0]?.id ?? allResultsId));
  const [selected, setSelected] = React.useState("");
  React.useEffect(() => {
    if (topId !== null) setSelected(topId);
  }, [topId]);

  // A search of three letters or more that found nothing anywhere, once every lookup has answered, is recorded
  // (its words only; trackSearchMiss says which words): what people look for and don't find is what search learns next.
  const missed = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!open) missed.current.clear();
  }, [open]);
  const listsIn = articlesReady && consulatesReady && titlesReady && citiesReady;
  const listFailed = articlesFailed || consulatesFailed || titlesFailed || citiesFailed;
  const nothingFound =
    open &&
    typed.length >= 3 &&
    !caseNumber &&
    !receipt &&
    !receiptish &&
    !month &&
    entityFor === typed &&
    !entityError &&
    entityHits.length === 0 &&
    suggestionsSettled &&
    suggestions.length === 0 &&
    listsIn &&
    !listFailed &&
    ranked === typed &&
    shown.length === 0;
  React.useEffect(() => {
    if (!nothingFound || missed.current.has(typed)) return;
    missed.current.add(typed);
    trackSearchMiss(typed);
  }, [nothingFound, typed]);

  if (!open) return null;

  // The bridge to the cross-program search, under the best group. The name rows answer "who is this employer"; this
  // one answers "what have they filed", across PERM, wage requests and LCAs at once, which no other row covers.
  const allResults =
    allResultsId !== null ? (
      <Command.Item
        value={allResultsId}
        onSelect={() => go(caseSearchHref({ q: query }), `every filing by "${typed}"`, query)}
        className={ACTION_ROW}
      >
        All results for &ldquo;{typed}&rdquo;
      </Command.Item>
    ) : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
      role="presentation"
    >
      <Command
        ref={panelRef}
        label="Search PERM Tracker"
        shouldFilter={false}
        value={selected}
        onValueChange={setSelected}
        role="dialog"
        aria-modal="true"
        aria-label="Search PERM Tracker"
        className="w-full max-w-xl border-border bg-background text-foreground border"
      >
        <div className="flex items-center gap-2 border-b-2 border-border px-4">
          {navPending ? (
            <CircleNotchIcon
              aria-hidden="true"
              className="h-4 w-4 shrink-0 animate-spin text-foreground motion-reduce:animate-none"
              weight="bold"
            />
          ) : (
            <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <Command.Input
            ref={inputRef}
            autoFocus
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setRecentsCleared(false);
            }}
            /* MEASURED, NOT ESTIMATED. The old string was 60 characters and
               487.8px of real Inter at 16px; this input's box is 226px wide on
               a 320px phone and 266px on a 360px one, so two thirds of it was
               simply not on screen and the field stopped saying what it takes.
               This one is 214.5px, under the 220px floor `scripts/audit_
               placeholders.py` derives, so it fits every width. The full list
               is in the hint line below, which is where a list belongs. */
            placeholder="Name, page or case number"
            className="min-h-[52px] w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>
        {/* The persistent hint. It does not truncate, it does not disappear
            the moment you type, and it is the only place that can hold the
            whole list of what this box accepts. */}
        <p className="border-b-2 border-border px-4 py-2 text-sm leading-snug text-muted-foreground">
          Employers, law firms, occupations, job titles, cities, consulates, pages and articles.
          Paste a G-, A-, P-, I- or H- case number and it goes straight to the lookup.
        </p>
        {navTarget !== null ? (
          <p
            role="status"
            className="flex items-center gap-2 border-b-2 border-border bg-tint px-4 py-2 text-sm font-bold"
          >
            <CircleNotchIcon
              aria-hidden="true"
              className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
              weight="bold"
            />{" "}
            <span>Opening {navTarget}…</span>
          </p>
        ) : null}
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {showRecents ? `${recentSearchCount(recents.length)}.` : recentsCleared ? RECENT_CLEARED : ""}
        </p>
        <Command.List className="max-h-[55vh] overflow-y-auto p-2">
          {showRecents ? (
            /* Before anything is typed: what this visitor searched for lately, first, with Clear beside the
               heading. The button sits outside the group, whose heading cmdk hides from screen readers. */
            <div className="relative">
              <Command.Group heading={RECENT_HEADING} className={RECENT_GROUP}>
                {recents.map((r) => (
                  <Command.Item
                    key={r.href}
                    value={`recent ${r.href}`}
                    onSelect={() => go(r.href, r.label, r.label)}
                    className={ROW}
                  >
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
          ) : null}
          {/* WHY THIS IS NOT INSIDE `Command.Empty`. It was, and `Command.Empty`
              renders only when NOTHING matches - but the static index almost
              always matches something, so the corpus lookup ran with no signal
              at all on exactly the queries it exists for. Typing an employer
              name showed a page list and no indication anything was still
              being fetched. */}
          {searchingEntities ? (
            <p
              role="status"
              className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground"
            >
              <CircleNotchIcon
                aria-hidden="true"
                className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
                weight="bold"
              />{" "}
              <span>Searching employers, firms and occupations…</span>
            </p>
          ) : null}
          {entityError ? (
            <p role="status" className="px-3 py-2.5 text-sm text-soft">
              The corpus lookup didn&apos;t load, so employers, firms and
              occupations are missing from this list. The pages below still
              work.
            </p>
          ) : null}
          {/* The rows that act on exactly what was typed come first, whatever else matches: a number typed without
              its dashes once scored too low against its own row to show its lookup. */}
          {caseNumber ? (
            <Command.Item
              forceMount
              value={`case ${caseNumber}`}
              onSelect={() => go(`/perm-case-status?case=${encodeURIComponent(caseNumber)}`, `case ${caseNumber}`, caseNumber)}
              className={ACTION_ROW}
            >
              Check case {caseNumber}: live status and estimate
            </Command.Item>
          ) : null}
          {receipt ? (
            <Command.Item
              forceMount
              value={`receipt ${receipt}`}
              onSelect={() => go(`/uscis-case-status?receipt=${encodeURIComponent(receipt)}`, `receipt ${receipt}`, receipt)}
              className={ACTION_ROW}
            >
              Look up USCIS receipt {receipt}: what it says
            </Command.Item>
          ) : null}
          {month ? (
            <Command.Item
              forceMount
              value={`month ${month}`}
              onSelect={() =>
                go(
                  `/tools/perm-timeline-calculator?month=${encodeURIComponent(month)}`,
                  `cases filed ${month}`,
                  month,
                )
              }
              className={ACTION_ROW}
            >
              Estimate for cases filed {month}
            </Command.Item>
          ) : null}

          <Command.Empty className="px-3 py-6 text-sm text-muted-foreground">
            {/* The searching and failure cases are stated above, once, for the
                whole list. Repeating "searching" here made an empty result and
                an in-flight one look the same. */}
            {searchingEntities
              ? null
              : suggesting
                ? `Nothing matches “${query.trim()}” exactly. Looking for close names…`
                : `Nothing matches “${query.trim()}”. Try an employer, a law firm, a page name, or a case number.`}
          </Command.Empty>

          {shown.map((g, i) => (
            <React.Fragment key={g.heading}>
              <Command.Group heading={g.heading} className={GROUP_HEADING}>
                {g.rows.map((row) => (
                  <Command.Item
                    key={row.id}
                    value={row.id}
                    onSelect={() => go(row.href, row.label, typed === "" ? null : row.keepsQuery ? query : row.label)}
                    className={ROW}
                  >
                    {row.note === undefined ? (
                      row.whole ? keepWhole(row.label) : row.label
                    ) : (
                      <>
                        <span className="min-w-0 truncate">{row.whole ? keepWhole(row.label) : row.label}</span>{" "}
                        <span className="shrink-0 text-sm text-muted-foreground">{row.note}</span>
                      </>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
              {i === 0 ? allResults : null}
            </React.Fragment>
          ))}
          {shown.length === 0 ? allResults : null}

          {typed !== "" && consulatesFailed && consulates.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Consulates couldn&apos;t load this time. Close search and open it again to retry.
            </p>
          ) : null}
          {typed !== "" && titlesFailed && socTitles.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Job titles couldn&apos;t load this time. Close search and open it again to retry.
            </p>
          ) : null}
          {typed !== "" && citiesFailed && cities.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Cities couldn&apos;t load this time. Close search and open it again to retry.
            </p>
          ) : null}
          {articlesFailed && articles.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Articles couldn&apos;t load this time. Close search and open it again to retry.
            </p>
          ) : null}
        </Command.List>
        <div className="border-t-2 border-border px-4 py-2 text-sm text-muted-foreground">
          Esc closes · Enter opens · a case number goes straight to the lookup
        </div>
      </Command>
    </div>
  );
}

export default SearchPalette;
