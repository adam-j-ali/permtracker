import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PolicyNotice } from "@/lib/db/policyNotices";

vi.mock("@/lib/db/policyNotices", () => ({ listPolicyNotices: vi.fn() }));

import { listPolicyNotices } from "@/lib/db/policyNotices";
import { ARCHIVE_LEAD, archiveLine, foldArchive } from "@/lib/policyArchive";
import { buildFeed } from "@/lib/policyFeed";
import { easternDay } from "@/lib/time";

import * as route from "../route";

/**
 * /policy-changes/archive.json: the lines of every year the policy page folds, fetched the first time a reader opens
 * one. They rode in the page itself until Nov 23 2026: 1,150 lines, 0.62 MB of its 1.64 MB of HTML.
 */

function n(documentNumber: string, publicationDate: string, type: string): PolicyNotice {
  return {
    documentNumber,
    publicationDate,
    type,
    title: `Title of ${documentNumber}`,
    abstract: "",
    url: `https://www.dol.gov/${documentNumber}`,
    agencies: ["Office of Foreign Labor Certification"],
    topics: ["perm"],
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

/** Twelve OFLC announcements: eight the page draws, four folded under 2019. */
const ROWS: PolicyNotice[] = [
  n("oflc-2026-a", "2026-08-14", "OFLC announcement"),
  n("oflc-2026-b", "2026-08-01", "OFLC announcement"),
  ...Array.from({ length: 10 }, (_, i) => n(`oflc-2019-${i}`, `2019-0${9 - (i % 9)}-1${i % 10}`, "OFLC announcement")),
];

beforeEach(() => {
  vi.mocked(listPolicyNotices).mockReset();
  vi.mocked(listPolicyNotices).mockResolvedValue(ROWS);
});

describe("GET /policy-changes/archive.json", () => {
  it("answers each list's folded lines by year, and none of the rows the page draws", async () => {
    // Act
    const res = await route.GET();
    const body = (await res.json()) as Record<string, Record<string, string[][]>>;
    // Assert
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["agencies", "decisions"]);
    const fold = foldArchive(buildFeed(ROWS, easternDay()).announcements, ARCHIVE_LEAD.agencies);
    // Control: the fixture really folds something, so an empty answer can't pass.
    expect(fold.years.flatMap((y) => y.notices)).toHaveLength(4);
    expect(body.agencies).toEqual(Object.fromEntries(fold.years.map((y) => [y.year, y.notices.map((d) => [...archiveLine(d)])])));
    const drawn = new Set(fold.recent.map((d) => d.documentNumber));
    for (const lines of Object.values(body.agencies!)) for (const [id] of lines) expect(drawn.has(id!)).toBe(false);
    expect(body.decisions).toEqual({});
  });

  it("is kept out of search results", async () => {
    const res = await route.GET();
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("refuses to answer an empty archive when the read fails, so the last good file stays", async () => {
    vi.mocked(listPolicyNotices).mockRejectedValue(new Error("libsql: timeout"));
    await expect(route.GET()).rejects.toThrow("libsql: timeout");
  });

  it("answers GET only, expired with the page", () => {
    // A route.ts exports handler names and its settings only; Next answers 405 to any other method.
    expect(Object.keys(route).sort()).toEqual(["GET", "revalidate"]);
    expect(route.revalidate).toBe(21600);
  });
});
