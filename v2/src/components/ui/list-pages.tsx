"use client";

import { useEffect, useEffectEvent } from "react";

import { clampPage, Pagination, usePageParam, usePerPage } from "@/components/ui/pagination";

/**
 * Pages for a long server-rendered list (`<ul id>` of `<li>`), keeping every item in the HTML. Owner, Oct 21 2026:
 * "pagination not endless scroll". Used where the list is the page's crawlable index (the A to Z pages exist so
 * every entity page is one link from an index) or plain server markup (the policy feed): crawlers and the
 * no-script reader get every item. What pages is the view: a style rule shows one page's
 * names (`nth-child`) and hides the rest, drawn on the server for page 1 so nothing moves on load, then for the
 * page in the address (`?page=3`). The list itself never re-renders.
 */
/** The page sizes a list of names offers, beside its own. */
const NAME_PAGE_SIZES = [50, 100, 200] as const;
/**
 * The most names a page holds on a phone until the reader picks: one column of 200 ran ten screens, and 50 still ran
 * past two and a half (the phone control walk, Nov 25 2026).
 */
export const PHONE_NAMES = 40;

export function ListPages({
  listId,
  total,
  perPage = 200,
  phonePerPage = PHONE_NAMES,
  paramKey,
  noun,
}: {
  /** The id of the list's <ul> (or <ol>, or a table's <tbody>): its child elements are the items. */
  listId: string;
  total: number;
  /** A wide screen's page. A phone gets `phonePerPage` at most until the reader picks a size. */
  perPage?: number;
  /** A phone's page, for items taller than one name: a bar with its label, a row of a table. */
  phonePerPage?: number;
  /**
   * The address key for this list's page ("states" reads ?states=2 and ?states-per=25), for a page holding more
   * than one paged list. Left out, the list uses ?page= and ?per=.
   */
  paramKey?: string;
  /** Plural ("employers"). */
  noun: string;
}) {
  const [param, setPage] = usePageParam(paramKey ?? "page");
  const narrow = Math.min(perPage, phonePerPage);
  const options = [...new Set([...NAME_PAGE_SIZES, perPage, narrow])].sort((a, b) => a - b);
  const rows = usePerPage({
    wide: perPage,
    narrow,
    options,
    key: paramKey ? `${paramKey}-per` : "per",
    pageKey: paramKey ?? "page",
  });
  const per = rows.per;
  const pageCount = Math.max(1, Math.ceil(total / per));
  const page = clampPage(param, pageCount);
  // A link to one item (/changelog#an-entry, /developers#op-search) opens the page that holds it, so it never lands on
  // a hidden row. It runs again when the page size settles (a phone's size arrives after the first paint), and only
  // while the address still names that item.
  const openLinkedItem = useEffectEvent((id: string, size: number) => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const list = document.getElementById(id);
    const target = hash ? document.getElementById(hash) : null;
    if (!list || !target) return;
    const index = [...list.children].findIndex((item) => item === target || item.contains(target));
    if (index < 0) return;
    const want = Math.floor(index / size) + 1;
    if (want !== page) setPage(want);
    window.setTimeout(() => target.scrollIntoView({ block: "start" }), 0);
  });
  useEffect(() => openLinkedItem(listId, per), [listId, per]);
  if (total <= Math.min(...options) && pageCount <= 1) return null;
  // A wide screen whose page holds every item has nothing to page: the pager shows on a phone only.
  const phoneOnly = total <= perPage && !rows.chosen;
  const first = (page - 1) * per + 1;
  const last = page * per;
  // Elements only: nth-child skips the text nodes between the items.
  const hideFrom = (n: number) => `#${listId} > :nth-child(n+${n + 1}) { display: none; }`;
  const rule = `#${listId} > :nth-child(-n+${first - 1}), ${hideFrom(last)}`;
  // The server doesn't know the screen, so page 1 is drawn at the wide size with a phone's shorter page in a media
  // rule beside it: a phone never paints the long page, and the list itself never re-renders.
  const firstPaint = `${hideFrom(perPage)} @media (max-width: 639px) { ${hideFrom(narrow)} }`;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: page === 1 ? (rows.chosen ? hideFrom(last) : `${firstPaint} ${hideFrom(last)}`) : rule }} />
      <div className={phoneOnly ? "sm:hidden" : undefined}>
      <Pagination
        page={page}
        pageCount={pageCount}
        onPage={(n) => {
          setPage(n);
          document.getElementById(listId)?.scrollIntoView({ block: "start" });
        }}
        total={total}
        perPage={per}
        noun={noun}
        label={`Pages of ${noun}`}
        className="mt-8"
        per={rows}
      />
      </div>
    </>
  );
}
