"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";

import { Pagination, usePagedRows } from "@/components/ui/pagination";
import { fetchOnce } from "@/lib/fetchOnce";
import type { ArchiveBook, ArchiveLine, ArchiveList } from "@/lib/policyArchive";

import { ArchiveLines } from "./ArchiveLines";

const isBook = (v: unknown): v is ArchiveBook =>
  typeof v === "object" && v !== null && typeof (v as ArchiveBook).agencies === "object" && typeof (v as ArchiveBook).decisions === "object";

/** Every folded year's lines, from /policy-changes/archive.json, fetched at most once a visit. */
export const loadArchive = fetchOnce("/policy-changes/archive.json", isBook);

/**
 * One folded year of a long list on /policy-changes. The page sends the year and its count; the lines load the first
 * time a reader opens the year, and show a page at a time, 25 on a wide screen and 10 on a phone. A year opened
 * before the page started is caught when it does.
 */
export function ArchiveYear({
  list,
  year,
  count,
  noun,
  load = loadArchive,
}: {
  list: ArchiveList;
  year: string;
  count: number;
  /** What one line is ("announcement"), for the summary and the pager. */
  noun: string;
  /** Where the lines come from; tests pass their own. */
  load?: () => Promise<ArchiveBook>;
}) {
  const fold = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [got, setGot] = useState<{ lines: readonly ArchiveLine[] | null; failed: boolean }>({ lines: null, failed: false });
  const plural = `${noun}s`;

  useEffect(() => {
    if (fold.current?.open) setOpen(true);
  }, []);

  useEffect(() => {
    if (!open || got.lines || got.failed) return;
    let live = true;
    load().then(
      (book) => {
        if (!live) return;
        const lines = book[list]?.[year];
        setGot(lines ? { lines, failed: false } : { lines: null, failed: true });
      },
      () => live && setGot({ lines: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [open, got.lines, got.failed, load, list, year]);

  return (
    <details ref={fold} className="group border-b-2 border-border last:border-b-0" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-heading text-base font-bold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span>{year}</span>{" "}
          <span className="font-mono text-sm font-bold text-muted-foreground">
            {`${count} ${count === 1 ? noun : plural}`}
          </span>
        </span>{" "}
        <CaretDownIcon className="doc-caret" aria-hidden="true" />
      </summary>{" "}
      {open ? (
        got.lines ? (
          <YearLines lines={got.lines} year={year} plural={plural} />
        ) : (
          <p role="status" className="border-t-2 border-border/40 px-5 pb-4 pt-3 text-base text-soft sm:px-6">
            {got.failed ? (
              <>
                {`The ${year} ${plural} couldn't be loaded just now. `}
                <button type="button" className="link min-h-[44px]" onClick={() => setGot({ lines: null, failed: false })}>
                  Try again
                </button>
              </>
            ) : (
              `Loading the ${year} ${plural}…`
            )}
          </p>
        )
      ) : null}
    </details>
  );
}

function YearLines({ lines, year, plural }: { lines: readonly ArchiveLine[]; year: string; plural: string }) {
  const top = useRef<HTMLDivElement>(null);
  const paged = usePagedRows(lines);
  return (
    <div ref={top} className="scroll-mt-24">
      <ArchiveLines lines={paged.shown} />{" "}
      <Pagination
        page={paged.page}
        pageCount={paged.pageCount}
        onPage={paged.setPage}
        total={lines.length}
        perPage={paged.perPage}
        noun={plural}
        label={`Pages of the ${year} ${plural}`}
        scrollTo={top}
        per={paged.per}
        className="px-5 pb-4 sm:px-6"
      />
    </div>
  );
}
