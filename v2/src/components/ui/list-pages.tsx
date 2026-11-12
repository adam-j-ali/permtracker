"use client";

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
/** The most names a page holds on a phone until the reader picks: one column of 200 ran ten screens. */
export const PHONE_NAMES = 50;

export function ListPages({
  listId,
  total,
  perPage = 200,
  noun,
}: {
  /** The id of the list's <ul>. */
  listId: string;
  total: number;
  /** A wide screen's page. A phone gets PHONE_NAMES at most until the reader picks a size. */
  perPage?: number;
  /** Plural ("employers"). */
  noun: string;
}) {
  const [param, setPage] = usePageParam();
  const narrow = Math.min(perPage, PHONE_NAMES);
  const options = [...new Set([...NAME_PAGE_SIZES, perPage])].sort((a, b) => a - b);
  const rows = usePerPage({ wide: perPage, narrow, options });
  const per = rows.per;
  const pageCount = Math.max(1, Math.ceil(total / per));
  const page = clampPage(param, pageCount);
  if (total <= Math.min(...options) && pageCount <= 1) return null;
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
    </>
  );
}
