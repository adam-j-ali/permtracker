import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two entity-page reads that were the Turso bill.
 *
 * Both walked every row of the kind per render (71,512 employers) and were
 * invisible in dev. These pin the SQL shapes that the production EXPLAIN
 * showed to be index-served on 2026-09-02, so a "cleaner" rewrite cannot
 * quietly put the scan back.
 */

vi.mock("server-only", () => ({}));

const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
// `unstable_cache` needs Next's incremental-cache context, which does not
// exist in a bare unit test: it throws "Invariant: incrementalCache missing".
// These tests assert the SQL that reaches the driver, so the cache is mocked
// to a pass-through. That keeps the subject of the test the query, not the
// caching layer wrapped around it.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: () => undefined,
  revalidatePath: () => undefined,
}));

vi.mock("../client", () => ({ rows, one }));

const { nameVariants } = await import("../entityDetail");
const { fieldDistribution, lettersStartAWord, searchByLetters, searchNameOrLetters } = await import("../entities");
const { countPageworthy, getAllEntities, getEntitySeed } = await import("../publicData");

beforeEach(() => {
  rows.mockReset();
  one.mockReset();
  rows.mockResolvedValue([]);
});

describe("searchByLetters", () => {
  it("strips spaces, hyphens, apostrophes, periods, commas and ampersands in SQL", async () => {
    await searchByLetters("employer", "walmart");
    const [sql, args] = rows.mock.calls[0]!;
    // Each strip is its own replace(). An unquoted apostrophe literal broke this
    // once while every mocked test still passed, so the literals are asserted.
    for (const lit of ["' '", "'-'", "''''", "'.'", "','", "'&'"]) {
      expect(sql).toContain(lit + ", ''");
    }
    expect((sql.match(/'/g) ?? []).length % 2).toBe(0);
    expect(args).toEqual(["employer", "%walmart%", 25]);
  });

  it("drops a whole-word 'and' from the name, so 'Johnson and Johnson' and 'Johnson & Johnson' read alike", async () => {
    await searchByLetters("employer", "johnsonjohnson");
    expect(rows.mock.calls[0]![0]).toContain("' and ', ' '");
  });

  it("refuses anything but plain letters, so LIKE's wildcards never reach it", async () => {
    for (const bad of ["wal%mart", "wal_mart", "abc", "WALMART", "wal mart"]) {
      expect(await searchByLetters("employer", bad)).toEqual([]);
    }
    expect(rows).not.toHaveBeenCalled();
  });
});

describe("nameVariants", () => {
  it("is a half-open range on merge_key, never OR + LIKE", async () => {
    one.mockResolvedValueOnce({ merge_key: "deloitte consulting" });
    await nameVariants("employer", "deloitte-consulting-llp");
    const [sql, args] = rows.mock.calls[0]!;
    expect(sql).toMatch(/WHERE kind = \? AND merge_key >= \? AND merge_key < \? AND slug <> \?/);
    expect(sql).not.toMatch(/LIKE/);
    expect(args?.slice(0, 4)).toEqual(["employer", "deloitte", "deloitte!", "deloitte-consulting-llp"]);
  });
});

describe("fieldDistribution", () => {
  it("filters on the exact expression the index is built on, and sizes the kind from the top rank", async () => {
    one.mockResolvedValueOnce({ n: 71512 });
    const d = await fieldDistribution("employer", 5);
    const cohortSql = rows.mock.calls[0]![0];
    expect(cohortSql).toMatch(/WHERE kind = \? AND \(IFNULL\(certified, 0\) \+ IFNULL\(denied, 0\)\) >= \?/);
    const sizeSql = one.mock.calls[0]![0];
    expect(sizeSql).toMatch(/SELECT rank AS n FROM perm_entities WHERE kind = \? ORDER BY rank DESC LIMIT 1/);
    expect(sizeSql).not.toMatch(/count\(\*\)/i);
    expect(d.kindTotal).toBe(71512);
  });
});

describe("countPageworthy", () => {
  // 67.25B of the 98.4B rows billed Sep 2 to Sep 26 2026 were a count(*)
  // over the kind, three per entity-page render. The last rank is the count
  // whenever the tail clears the floor.
  it("reads the last-ranked row, not a count, when the tail clears the floor", async () => {
    one.mockResolvedValueOnce({ rank: 71512, total: 1 });
    expect(await countPageworthy("employer")).toBe(71512);
    expect(one).toHaveBeenCalledTimes(1);
    const [sql, args] = one.mock.calls[0]!;
    expect(sql).toMatch(/SELECT rank, total FROM perm_entities WHERE kind = \? ORDER BY rank DESC LIMIT 1/);
    expect(sql).not.toMatch(/count\(\*\)/i);
    expect(args).toEqual(["employer"]);
  });

  it("falls back to counting when the last-ranked entity is under the floor", async () => {
    one.mockResolvedValueOnce({ rank: 900, total: 0 }).mockResolvedValueOnce({ n: "850" });
    expect(await countPageworthy("attorney")).toBe(850);
    expect(one.mock.calls[1]![0]).toMatch(/count\(\*\)/i);
  });

  it("is what the seed prints as the kind's size", async () => {
    rows.mockResolvedValueOnce([]);
    one.mockResolvedValueOnce({ rank: 1410, total: 3 });
    const seed = await getEntitySeed("occupation", 10);
    expect(seed.total).toBe(1410);
    expect(one.mock.calls.every(([sql]) => !/count\(\*\)/i.test(sql))).toBe(true);
  });
});

describe("getAllEntities", () => {
  const row = (rank: number) => ({
    slug: `e${rank}`, name: `E ${rank}`, rank, total: 10, certified: 5, denied: 1,
    median_days: 300, median_annual_wage: 100000, state: "CA", code: null,
  });

  it("reads the bulk list in rank windows, in order, and stops at the first empty window", async () => {
    // One 9,654-row answer waited past the 20-second deadline inside a busy web copy (Sentry 59, 181
    // events since Oct 20) while the database answered it in well under a second.
    rows
      .mockResolvedValueOnce([row(1), row(2)])
      .mockResolvedValueOnce([row(2501)])
      .mockResolvedValueOnce([]);
    const got = await getAllEntities("employer");
    expect(got.map((r) => r.slug)).toEqual(["e1", "e2", "e2501"]);
    expect(rows).toHaveBeenCalledTimes(3);
    for (const [i, [sql, args]] of rows.mock.calls.entries()) {
      expect(sql).toMatch(/rank > \? AND rank <= \?/);
      expect(sql).toContain("ORDER BY rank");
      expect(sql).not.toMatch(/OFFSET/i);
      expect(args).toEqual(["employer", 5, i * 2500, (i + 1) * 2500]);
    }
  });
});

describe("searchNameOrLetters (the site's name search, Batch 5, Nov 25 2026)", () => {
  const row = (slug: string, rank: number) => ({ kind: "employer", slug, name: slug.replace(/-/g, " "), rank, total: 10, certified: 9, denied: 1 });
  beforeEach(() => rows.mockReset());

  it("returns the name matches first, then the letters-only ones, with no repeats", async () => {
    rows.mockImplementation(async (...a: unknown[]) => {
      return String(a[0]).includes("name LIKE ?") ? [row("macys-systems", 2)] : [row("macys-systems", 2), row("macy-s-corporate", 5)];
    });
    const got = await searchNameOrLetters("employer", "macys", 10);
    expect(got.map((r) => r.slug)).toEqual(["macys-systems", "macy-s-corporate"]);
  });

  it("finds 'walmart', 'johnson and johnson' and 'baker mckenzie' through the letters", async () => {
    rows.mockImplementation(async (...a: unknown[]) => (String(a[0]).includes("name LIKE ?") ? [] : [row("walmart-johnson-johnson-baker-mckenzie", 1)]));
    for (const q of ["walmart", "johnson and johnson", "baker mckenzie"]) {
      rows.mockClear();
      expect((await searchNameOrLetters("employer", q, 10)).map((r) => r.slug)).toEqual(["walmart-johnson-johnson-baker-mckenzie"]);
      const lettersCall = rows.mock.calls.find(([sql]) => !String(sql).includes("name LIKE ?"));
      expect(lettersCall?.[1]?.[1]).toBe(q === "walmart" ? "%walmart%" : q === "baker mckenzie" ? "%bakermckenzie%" : "%johnsonjohnson%");
    }
  });

  it("skips the letters search under four letters", async () => {
    rows.mockResolvedValue([]);
    await searchNameOrLetters("employer", "ab", 10);
    expect(rows.mock.calls.every(([sql]) => String(sql).includes("name LIKE ?"))).toBe(true);
  });
});

describe("lettersStartAWord", () => {
  it("keeps a match that starts a word and drops one buried inside a word", () => {
    expect(lettersStartAWord("Macy's Corporate Services LLC", "macys")).toBe(true);
    expect(lettersStartAWord("WAL-MART ASSOCIATES, INC.", "walmart")).toBe(true);
    expect(lettersStartAWord("Kenvue Brands LLC (F/K/A Johnson & Johnson Consumer, Inc.)", "johnsonjohnson")).toBe(true);
    expect(lettersStartAWord("C & D Pharmacy Services Inc", "macys")).toBe(false);
  });
});
