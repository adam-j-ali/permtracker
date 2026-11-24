import { describe, expect, it } from "vitest";

import type { PolicyNotice } from "@/lib/db/policyNotices";
import type { PolicyFeed } from "@/lib/policyFeed";

import { ARCHIVE_LEAD, archiveBook, archiveLine, foldArchive } from "../policyArchive";

/**
 * The policy page's long lists: the newest few as full rows, the rest by year. The page draws the rows and each year's
 * count; the year's lines load when a reader opens it (/policy-changes/archive.json), from this same fold, so the
 * count on the fold and the lines inside it can't disagree.
 */

function n(documentNumber: string, publicationDate: string, type = "OFLC announcement"): PolicyNotice {
  return {
    documentNumber,
    publicationDate,
    type,
    title: `Title of ${documentNumber}`,
    abstract: "",
    url: `https://www.dol.gov/${documentNumber}`,
    agencies: ["Office of Foreign Labor Certification"],
    topics: [],
    effectiveOn: null,
    commentsCloseOn: null,
    commentUrl: null,
    citation: null,
    action: null,
    dates: null,
    correctionOf: null,
    pdfUrl: null,
    source: null,
    status: null,
    piFiled: null,
    signingDate: null,
    supersededBy: null,
  };
}

/** Newest first, as the feed holds them: three this year, five in 2025, four in 2019. */
const ITEMS: PolicyNotice[] = [
  n("a1", "2026-08-14"),
  n("a2", "2026-07-01"),
  n("a3", "2026-01-05"),
  ...Array.from({ length: 5 }, (_, i) => n(`b${i}`, `2025-0${9 - i}-10`)),
  ...Array.from({ length: 4 }, (_, i) => n(`c${i}`, `2019-0${9 - i}-10`)),
];

describe("foldArchive", () => {
  it("keeps the newest as rows and groups the rest by year, newest year first, in the list's own order", () => {
    // Act
    const fold = foldArchive(ITEMS, 4);
    // Assert
    expect(fold.recent.map((d) => d.documentNumber)).toEqual(["a1", "a2", "a3", "b0"]);
    expect(fold.years.map((y) => [y.year, y.notices.map((d) => d.documentNumber)])).toEqual([
      ["2025", ["b1", "b2", "b3", "b4"]],
      ["2019", ["c0", "c1", "c2", "c3"]],
    ]);
  });

  it("folds nothing when the list is no longer than its lead", () => {
    expect(foldArchive(ITEMS.slice(0, 3), 8)).toEqual({ recent: ITEMS.slice(0, 3), years: [] });
  });
});

describe("archiveLine", () => {
  it("is the document's id, its day and source, its address and its title", () => {
    expect(archiveLine(n("x9", "2019-03-02"))).toEqual(["x9", "Mar 2, 2019, OFLC", "https://www.dol.gov/x9", "Title of x9"]);
    expect(archiveLine(n("y1", "2024-11-20", "BALCA decision"))[1]).toMatch(/^Nov 20, 2024, /);
  });
});

describe("archiveBook", () => {
  const feed = { register: [], filed: [], signed: [], bills: [], announcements: ITEMS, decisions: ITEMS.slice(0, 7) } as unknown as PolicyFeed;

  it("holds every folded line of both lists by year, and none of the rows the page draws", () => {
    // Act
    const book = archiveBook(feed);
    // Assert
    expect(Object.keys(book).sort()).toEqual(["agencies", "decisions"]);
    const agencies = foldArchive(ITEMS, ARCHIVE_LEAD.agencies);
    for (const y of agencies.years) {
      expect(book.agencies[y.year]).toEqual(y.notices.map(archiveLine));
    }
    const drawn = new Set(agencies.recent.map((d) => d.documentNumber));
    for (const lines of Object.values(book.agencies)) for (const [id] of lines) expect(drawn.has(id)).toBe(false);
    // Decisions lead with six: the seventh is folded under its year.
    expect(book.decisions).toEqual({ "2025": [archiveLine(ITEMS[6]!)] });
  });

  it("is plain data: every line four strings", () => {
    const book = archiveBook(feed);
    for (const list of Object.values(book)) {
      for (const lines of Object.values(list)) {
        for (const line of lines) {
          expect(line).toHaveLength(4);
          for (const part of line) expect(typeof part).toBe("string");
        }
      }
    }
  });
});
