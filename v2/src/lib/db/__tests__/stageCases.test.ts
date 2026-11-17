import { describe, expect, it, vi } from "vitest";

/**
 * The per-stage listing rule, and the query behind it.
 *
 * Like `changes.test.ts` and `liveEmployers.test.ts`, this asserts the SQL the
 * module ISSUES rather than mocking a result set, because every defect worth
 * pinning lives in the predicate. A version filtered differently from
 * `getReviewStages` would return perfectly well-formed rows under a total
 * computed from a different population, and shaped fixture output passes
 * either way.
 */

vi.mock("server-only", () => ({}));

const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
vi.mock("../client", () => ({ rows, one }));

const {
  LISTABLE_STAGE_MAX,
  SMALL_STAGE_MAX,
  getStageHistory,
  listStageCases,
  stageListing,
} = await import("../rfi");

describe("stageListing", () => {
  it("lists every non-empty cohort, however small, and only an empty stage is withheld", () => {
    // The under-20 floor was removed on Sep 8 2026 at the owner's call: DOL
    // serves every one of these rows through its own lookup already.
    expect(stageListing(0)).toBe("too-small");
    expect(stageListing(1)).toBe("list");
    expect(stageListing(2)).toBe("list");
    expect(stageListing(SMALL_STAGE_MAX - 1)).toBe("list");
  });

  it("sends the 93,219-case queue somewhere better instead of listing it", () => {
    expect(stageListing(93_219)).toBe("too-large");
    expect(stageListing(LISTABLE_STAGE_MAX + 1)).toBe("too-large");
  });

  it("lists the stages in between, which is every real review stage", () => {
    // The five measured on 2026-08-30.
    for (const n of [2_335, 1_855, 974, 351, 108]) {
      expect(stageListing(n), `${n} cases`).toBe("list");
    }
    // And the boundaries themselves, so a fencepost change is visible.
    expect(stageListing(SMALL_STAGE_MAX)).toBe("list");
    expect(stageListing(LISTABLE_STAGE_MAX)).toBe("list");
  });

  it("leaves daylight between the ceiling and the largest real review stage", () => {
    // The rule must not be tuned to today's numbers. RECONSIDERATION APPEALS
    // is the largest listed stage; if the ceiling ever sat near it, ordinary
    // growth would silently switch a page from a list to a redirect.
    expect(LISTABLE_STAGE_MAX).toBeGreaterThan(2_335 * 4);
    expect(LISTABLE_STAGE_MAX).toBeLessThan(93_219);
  });
});

describe("listStageCases", () => {
  it("filters exactly as the count does, so the two cannot disagree", async () => {
    rows.mockReset();
    rows.mockResolvedValue([]);
    await listStageCases("RFI ISSUED", 250, 0);

    const sql = String(rows.mock.calls[0]![0]).replace(/\s+/g, " ");
    // Both predicates `getReviewStages` uses. Without the first the list would
    // include decided cases the total excludes; without the second it would
    // include DOL's own test fixture, which on the rare stages is most of the
    // stage.
    expect(sql).toContain("c.is_final = 0");
    expect(sql).toContain("c.employer_name IS NOT ?");
    expect(sql).toContain("c.current_status = ?");
    // Oldest first: the top row is the point of the page.
    expect(sql).toContain("ORDER BY c.filing_date, c.case_number");

    const args = rows.mock.calls[0]![1] as unknown[];
    expect(args[0]).toBe("RFI ISSUED");
    expect(args[1]).toBe("bah-test-company-name");
    expect(args[2]).toBe(250);
    expect(args[3]).toBe(0);
  });

  it("rides case_status_stage rather than scanning the pending partition", async () => {
    // Verified against production with EXPLAIN QUERY PLAN. Before the index:
    //   SEARCH perm_case_status USING INDEX case_status_final (is_final=?)
    // which reads all ~98,000 pending rows to return 974. After:
    //   SEARCH perm_case_status USING INDEX case_status_stage
    //          (current_status=? AND is_final=?)
    // The index is created by ingest_case_status_direct.py, and the shape of
    // this query is what makes it usable: an equality on current_status FIRST,
    // then is_final, then the ordering column. A query that filtered status
    // any other way - a LIKE, an IN, an OR - could not use it, and would be
    // the read-cost shape that got Turso reads blocked in August.
    rows.mockReset();
    rows.mockResolvedValue([]);
    await listStageCases("APPLICATION ON HOLD", 250, 0);

    const sql = String(rows.mock.calls[0]![0]).replace(/\s+/g, " ");
    expect(sql).toMatch(/WHERE c\.current_status = \?/);
    // The employer slug is JOINED, not derived. Slugifying the name in the
    // page would 404 on exactly the employers DOL spells several ways.
    expect(sql).toContain("LEFT JOIN perm_live_recent l ON l.case_number = c.case_number");
    expect(sql).not.toContain("LIKE");
    expect(sql).not.toContain(" OR ");
  });

  it("maps the row shape and keeps nulls as nulls", async () => {
    rows.mockReset();
    rows.mockResolvedValue([
      {
        case_number: "G-100-24249-318624",
        filing_date: "2024-09-05",
        employer_name: "ABOUT GLAMOUR INC",
        employer_slug: "about-glamour-inc",
        job_title: null,
      },
      // Discovered since last night's rebuild, so the remainder table has no
      // row yet and the LEFT JOIN gives null. The page must render an
      // unlinked name here rather than deriving a URL from the name.
      {
        case_number: "G-100-26001-999999",
        filing_date: "2026-08-29",
        employer_name: "BRAND NEW LLC",
        employer_slug: null,
        job_title: "Analyst",
      },
    ]);
    const got = await listStageCases("RFI ISSUED", 10, 0);
    expect(got).toEqual([
      {
        caseNumber: "G-100-24249-318624",
        filingDate: "2024-09-05",
        deniedOn: null,
        employer: "ABOUT GLAMOUR INC",
        employerSlug: "about-glamour-inc",
        jobTitle: null,
      },
      {
        caseNumber: "G-100-26001-999999",
        filingDate: "2026-08-29",
        deniedOn: null,
        employer: "BRAND NEW LLC",
        employerSlug: null,
        jobTitle: "Analyst",
      },
    ]);
  });
});

describe("getStageHistory", () => {
  // 10 AM Eastern on Nov 10 2026, inside DOL's Nov 10 day; Aug 28 is the record's catch-up.
  const NOV10 = Date.UTC(2026, 10, 10, 15);
  const CATCH_UP = Date.UTC(2026, 7, 28, 15);

  function answer(sql: string): unknown[] {
    if (sql.includes("FROM perm_case_status c")) {
      return [
        { case_number: "G-1", filing_date: "2025-01-02", employer_name: "A", employer_slug: "a", job_title: "x", denied_on: null },
        { case_number: "G-2", filing_date: "2025-02-03", employer_name: "B", employer_slug: null, job_title: "y", denied_on: "2026-06-12" },
        { case_number: "G-3", filing_date: "2025-03-04", employer_name: "C", employer_slug: null, job_title: "z", denied_on: null },
      ];
    }
    if (sql.includes("WHERE to_status = ?")) {
      return [
        { case_number: "G-1", changed_at: NOV10 },
        { case_number: "G-2", changed_at: CATCH_UP },
        { case_number: "G-9", changed_at: NOV10 - 30 * 86_400_000 },
      ];
    }
    if (sql.includes("WHERE e.from_status = ?")) {
      return [
        { case_number: "G-9", changed_at: NOV10, to_status: "CERTIFIED", filing_date: "2024-12-01", employer_name: "D", job_title: "w", current_status: "CERTIFIED", employer_slug: "d", denied_on: null },
      ];
    }
    return [];
  }

  it("dates each waiting case from its seen arrival, or an appeal's denial, and times each exit", async () => {
    rows.mockReset();
    rows.mockImplementation(async (sql: string) => answer(sql.replace(/\s+/g, " ")));
    const got = await getStageHistory("RECONSIDERATION APPEALS", 100);
    expect(got.cases.map((c) => [c.caseNumber, c.startOn, c.startSource])).toEqual([
      ["G-1", "2026-11-10", "seen"],
      ["G-2", "2026-06-12", "denied"],
      ["G-3", null, "unknown"],
    ]);
    expect(got.exits).toHaveLength(1);
    expect(got.exits[0]).toMatchObject({ caseNumber: "G-9", to: "CERTIFIED", leftOn: "2026-11-10", startOn: "2026-10-11", days: 30 });
  });

  it("never uses DOL's denial date to start a wait on a stage that isn't an appeal", async () => {
    rows.mockReset();
    rows.mockImplementation(async (sql: string) => answer(sql.replace(/\s+/g, " ")));
    const got = await getStageHistory("RFI ISSUED", 100);
    expect(got.cases.find((c) => c.caseNumber === "G-2")?.startSource).toBe("unknown");
  });

  it("reads arrivals and exits by their status indexes, never by a per-case subquery", async () => {
    rows.mockReset();
    rows.mockResolvedValue([]);
    await getStageHistory("RFI ISSUED", 100);
    const sqls = rows.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " "));
    const arrivals = sqls.find((s) => s.includes("WHERE to_status = ?"))!;
    const exits = sqls.find((s) => s.includes("WHERE e.from_status = ?"))!;
    expect(arrivals).toContain("AND changed_at >= ?");
    expect(exits).toContain("e.changed_at >= ?");
    for (const s of sqls) expect(s).not.toMatch(/\(SELECT MAX/);
  });
});
