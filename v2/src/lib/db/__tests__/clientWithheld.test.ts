import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A name withheld at its owner's request, through the read layer every page
 * reads: rows() rewrites a neutral slug to the real one before the database
 * sees it, masks what comes back, and drops what a read by the real name asks
 * for. The settings are read when the module loads, so each test sets them and
 * imports afresh (this file runs in the isolated project).
 *
 * Every name here is made up; the real lists live in server settings only.
 */

vi.mock("server-only", () => ({}));

const execute = vi.fn();
vi.mock("@libsql/client/http", () => ({
  createClient: () => ({ execute }),
}));

const FIRMS =
  "example-law-group-pllc|Example Law Group, PLLC|Law firm||3|example-law-group-pllc-2,exampel-law-group|EXAMPLE LAW GROUP PLLC^Exampel Law Group";
const EMPLOYERS = "jane-q-example|Jane Q Example|Private household employer|G-100-25001-000001|1||";

const ENTITY = ["slug", "name", "rank", "total", "certified", "denied", "median_days", "median_annual_wage", "state", "code", "recent_12m"];
const firmRow = ["example-law-group-pllc", "Example Law Group, PLLC", 40, 120, 110, 2, 300, 95000, "TX", null, 30];

function answer(columns: string[], rows: unknown[][]) {
  return { columns, rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))), rowsAffected: 0 };
}

beforeEach(() => {
  vi.resetModules();
  execute.mockReset();
  process.env.DATABASE_URL = "libsql://test";
  process.env.DATABASE_AUTH_TOKEN = "t";
  process.env.WITHHELD_FIRMS = FIRMS;
  process.env.WITHHELD_EMPLOYERS = EMPLOYERS;
});

afterAll(() => {
  delete process.env.WITHHELD_FIRMS;
  delete process.env.WITHHELD_EMPLOYERS;
});

describe("rows() and a withheld firm", () => {
  it("reads the neutral page's slug as the real record, and masks it", async () => {
    const { getBySlug } = await import("../entities");
    execute.mockResolvedValueOnce(answer(ENTITY, [firmRow]));
    const row = await getBySlug("attorney", "law-firm-3");
    expect(execute.mock.calls[0]![0].args).toEqual(["attorney", "example-law-group-pllc"]);
    expect(row).toMatchObject({ slug: "law-firm-3", name: "Law firm 3", rank: 40, total: 120, certified: 110 });
  });

  it("finds nothing by the real slug, so the old URL answers 404", async () => {
    const { getBySlug } = await import("../entities");
    execute.mockResolvedValueOnce(answer(ENTITY, [firmRow]));
    expect(await getBySlug("attorney", "example-law-group-pllc")).toBeNull();
  });

  it("keeps a client's case with the firm's label, and drops it from a navigation list", async () => {
    const { rows } = await import("../client");
    const cols = ["case_number", "employer_name", "employer_slug", "attorney_name", "attorney_slug"];
    const read = ["G-100-24001-000002", "Acme Corp", "acme-corp", "Exampel Law Group", "exampel-law-group"];
    execute.mockResolvedValueOnce(answer(cols, [read]));
    expect(await rows("SELECT * FROM perm_cases WHERE employer_slug = ?", ["acme-corp"])).toEqual([
      { case_number: read[0], employer_name: "Acme Corp", employer_slug: "acme-corp", attorney_name: "Law firm 3", attorney_slug: "law-firm-3" },
    ]);
    execute.mockResolvedValueOnce(answer(["slug", "name"], [["example-law-group-pllc", "Example Law Group, PLLC"]]));
    expect(await rows("SELECT slug, name FROM perm_entities WHERE kind = 'attorney' AND rank > ?", [0], { withheld: "drop" })).toEqual([]);
  });

  it("pages on the rows read, so a dropped row neither ends the paging nor shifts the next page", async () => {
    const { rowsPaged } = await import("../client");
    const cols = ["case_number", "attorney_slug"];
    execute.mockResolvedValueOnce(
      answer(cols, [["a", "other-firm"], ["b", "example-law-group-pllc"], ["c", "other-firm"], ["d", "other-firm"]]),
    );
    const got = await rowsPaged(
      "SELECT * FROM perm_cases WHERE attorney_slug IN (?, ?) LIMIT ? OFFSET ?",
      ["other-firm", "example-law-group-pllc", 4, 0],
      3,
    );
    expect(got.page.map((r) => (r as { case_number: string }).case_number)).toEqual(["a", "c"]);
    expect(got.consumed).toBe(3);
    expect(got.more).toBe(true);
  });

  it("ends the paging when a list asked only by the real slug finds nothing", async () => {
    const { rowsPaged } = await import("../client");
    const cols = ["case_number", "attorney_slug"];
    execute.mockResolvedValueOnce(answer(cols, [["a", "exampel-law-group"], ["b", "exampel-law-group"], ["c", "exampel-law-group"]]));
    const got = await rowsPaged("SELECT * FROM perm_cases WHERE attorney_slug = ? LIMIT ? OFFSET ?", ["exampel-law-group", 3, 0], 2);
    expect(got).toEqual({ page: [], more: false, consumed: 2 });
  });
});

describe("an older case of a withheld firm, on the case page (Nov 21 2026)", () => {
  // An older row carries its firm's page slug, or its own name's, so the rankings count it; its name is whatever
  // the older file printed, which the list may not hold.
  const CASE_COLS = ["attorney_name", "attorney_slug", "naics", "worksite_city", "job_education", "layoff"];

  async function caseWith(attorneyName: string, attorneySlug: string) {
    execute.mockImplementation(async ({ sql, args }: { sql: string; args: unknown[] }) => {
      if (sql.includes("FROM perm_cases WHERE")) return answer(CASE_COLS, []);
      if (sql.includes("FROM perm_cases_history")) return answer(CASE_COLS, [[attorneyName, attorneySlug, null, null, null, null]]);
      if (sql.includes("FROM perm_entities")) {
        return answer(["slug"], (args as string[]).includes("example-law-group-pllc") ? [["example-law-group-pllc"]] : []);
      }
      return answer(["slug"], []);
    });
    const { getPermCaseDetail } = await import("../permCaseDetail");
    return getPermCaseDetail("A-16001-00009");
  }

  it("masks a spelling the list doesn't hold when the row carries the firm's slug, and links the neutral page", async () => {
    const got = await caseWith("Oldname Partners Immigration", "example-law-group-pllc");
    expect(got).toMatchObject({ attorneyName: "Law firm 3", attorneySlug: "law-firm-3" });
  });

  it("masks a spelling with its own slug whose entity key is the firm's", async () => {
    const got = await caseWith("The Example Law Group & Company", "the-example-law-group-company");
    expect(got).toMatchObject({ attorneyName: "Law firm 3", attorneySlug: "law-firm-3" });
  });

  it("leaves another firm's older case as DOL printed it, unlinked when it has no page", async () => {
    const got = await caseWith("Quiet Immigration Group, P.C.", "quiet-immigration-group-p-c");
    expect(got).toMatchObject({ attorneyName: "Quiet Immigration Group, P.C.", attorneySlug: null });
  });

  it("masks an older spelling in the law firm rankings, by its slug or by its entity key", async () => {
    const { getFirmRanks } = await import("../firmRanks");
    const cols = ["slug", "linked", "name", "rank", "prev_rank", "filings", "certified", "denied", "withdrawn", "positions", "employers", "median_days"];
    execute.mockResolvedValueOnce(
      answer(cols, [
        ["example-law-group-pllc", 1, "Oldname Partners Immigration", 4, null, 90, 88, 1, 1, 0, 30, 200],
        ["examplelaw-group-p-l-l-c", 0, "ExampleLaw Group P.L.L.C.", 9, null, 40, 40, 0, 0, 0, 12, 210],
        ["quiet-immigration-group", 0, "Quiet Immigration Group", 10, null, 39, 39, 0, 0, 0, 11, 190],
      ]),
    );
    const got = await getFirmRanks("perm", 2019, "US");
    expect(got.map((r) => [r.slug, r.name, r.filings])).toEqual([
      ["law-firm-3", "Law firm 3", 90],
      ["law-firm-3", "Law firm 3", 40],
      ["quiet-immigration-group", "Quiet Immigration Group", 39],
    ]);
  });
});

describe("the site's helpers", () => {
  it("know the real name from the neutral one, by kind", async () => {
    const w = await import("@/lib/privacy/withheld");
    expect(w.withholdingActive).toBe(true);
    expect(w.isWithheldQuery("attorney", "Example Law Group")).toBe(true);
    expect(w.isWithheldQuery("employer", "Example Law Group")).toBe(false);
    expect(w.isWithheldQuery("occupation", "Example Law Group")).toBe(false);
    expect(w.isWithheldQuery("attorney", "law-firm-3")).toBe(false);
    expect(w.neutralPageEntry("attorney", "law-firm-3")?.number).toBe(3);
    expect(w.neutralPageEntry("employer", "law-firm-3")).toBeNull();
    expect(w.isNeutralPath("/perm-employers/private-household-employer-1")).toBe(true);
    expect(w.withheldBySlug("attorney", "exampel-law-group")?.kind).toBe("firm");
    expect(w.shownName("JANE Q EXAMPLE")).toBe("Private household employer 1");
  });

  it("answer a case search by the withheld name with no match, before any read", async () => {
    const { planCaseSearch } = await import("@/lib/caseSearchRequest");
    const firm = await planCaseSearch(new URLSearchParams({ firm: "Example Law Group, PLLC" }));
    expect(firm).toMatchObject({ kind: "noMatch", field: "firm" });
    const employer = await planCaseSearch(new URLSearchParams({ q: "Jane Q Example" }));
    expect(employer).toMatchObject({ kind: "noMatch", field: "employer" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("resolve a neutral label in a firm box to that firm's page", async () => {
    const { nameCandidates } = await import("../nameSuggest");
    execute.mockResolvedValueOnce(answer(ENTITY, [firmRow]));
    const got = await nameCandidates("attorney", "Law firm 3", 8);
    expect(got).toEqual([expect.objectContaining({ slug: "law-firm-3", name: "Law firm 3", cases: 120 })]);
  });
});
