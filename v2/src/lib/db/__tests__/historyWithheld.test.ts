import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A name withheld at its owner's request, on every surface that now prints DOL's older files (the Nov 21 2026 sweep,
 * items 19 to 23): the /perm-cases list and name search, the decided-cases feed's older LCAs, the case page's
 * employer card and the seasonal case record. Each reads through rows() (src/lib/db/client.ts), so the test runs the
 * real read layer against a faked database and asserts what comes out. The older files print spellings the entry
 * never gathered; the history load maps them to today's page slug, and the slug masks the name beside it.
 *
 * Every name here is made up; the real lists live in server settings only.
 */

vi.mock("server-only", () => ({}));

const execute = vi.fn();
vi.mock("@libsql/client/http", () => ({
  createClient: () => ({ execute }),
}));

// An employer with a number (its page is "Employer 4") and one listed older spelling, and a law firm.
const EMPLOYERS = "acme-widgets|Acme Widgets Inc|Employer||4||ACME WIDGET CO";
const FIRMS = "example-law-group|Example Law Group|Law firm||3||";

type Answer = { columns: string[]; rows: unknown[][] };
const answers: { match: RegExp; answer: Answer }[] = [];

function respond(columns: string[], rows: unknown[][]) {
  return { columns, rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))), rowsAffected: 0 };
}

const CASE_COLS = [
  "case_number", "status", "received_date", "decision_date", "days", "employer_name", "employer_slug", "state",
  "job_title", "soc_code", "soc_title", "attorney_name", "attorney_slug", "wage",
];
const historyRow = (n: string, name: string, slug: string, firm: string | null = null, firmSlug: string | null = null) => [
  n, "certified", "2016-01-04", "2016-09-01", 241, name, slug, "OH", "Engineer", "17-2141.00", "Mechanical Engineers",
  firm, firmSlug, 90000,
];

beforeEach(() => {
  vi.resetModules();
  execute.mockReset();
  answers.length = 0;
  process.env.DATABASE_URL = "libsql://test";
  process.env.DATABASE_AUTH_TOKEN = "t";
  process.env.WITHHELD_EMPLOYERS = EMPLOYERS;
  process.env.WITHHELD_FIRMS = FIRMS;
  execute.mockImplementation(async ({ sql }: { sql: string }) => {
    const hit = answers.find((a) => a.match.test(sql));
    return hit ? respond(hit.answer.columns, hit.answer.rows) : respond([], []);
  });
});

afterAll(() => {
  delete process.env.WITHHELD_EMPLOYERS;
  delete process.env.WITHHELD_FIRMS;
});

const shown = (v: unknown) => JSON.stringify(v);

describe("the /perm-cases list and search over the older table", () => {
  it("masks an older spelling the entry never listed, by the page slug the history load gave it", async () => {
    answers.push({
      match: /FROM perm_cases_history WHERE/,
      answer: {
        columns: CASE_COLS,
        rows: [
          historyRow("A-16001-00001", "ACME WIDGETS MANUFACTURING CO OF OHIO", "acme-widgets"),
          historyRow("A-16001-00002", "ACME WIDGET CO", "acme-widget-co", "EXAMPLE LAW GROUP, P.C.", "example-law-group"),
        ],
      },
    });
    const { listCases } = await import("../cases");
    const page = await listCases({ filter: { slice: { kind: "all" }, from: "2015-10-01", to: "2016-09-30" } });
    expect(page.page.map((r) => [r.employerName, r.employerSlug])).toEqual([
      ["Employer 4", "employer-4"],
      ["Employer 4", "employer-4"],
    ]);
    expect(page.page[1]).toMatchObject({ attorneyName: "Law firm 3", attorneySlug: "law-firm-3" });
    expect(shown(page)).not.toMatch(/acme|widget|example law/i);
  });

  it("answers a name search by the withheld name's older spelling with nothing", async () => {
    answers.push({
      match: /FROM perm_cases_history/,
      answer: { columns: CASE_COLS, rows: [historyRow("A-16001-00003", "ACME WIDGET CO", "acme-widget-co")] },
    });
    const { searchCases } = await import("../cases");
    const found = await searchCases({ field: "employer", text: "ACME WIDGET CO", limit: 10 });
    expect(shown(found)).not.toMatch(/acme|widget/i);
  });
});

describe("the decided-cases feed's older LCAs", () => {
  it("masks the employer and the law firm on an LCA from DOL's FY2008 to FY2019 files", async () => {
    answers.push(
      { match: /PRAGMA table_info\(lca_cases_history\)/, answer: { columns: ["name"], rows: [["case_number"], ["employer_slug"], ["attorney_slug"]] } },
      {
        match: /FROM lca_cases_history/,
        answer: {
          columns: ["case_number", "status", "decision_date", "received_date", "employer_name", "employer_slug", "attorney_name", "attorney_slug"],
          rows: [["I-200-15100-000001", "CERTIFIED", "2015-04-10", "2015-04-01", "ACME WIDGET CO", "acme-widget-co", "Example Law Group", "example-law-group"]],
        },
      },
    );
    const { getDecidedFeed } = await import("../decidedDays");
    const feed = await getDecidedFeed({ range: { from: "2015-04-10", to: "2015-04-10" }, programs: ["lca"] });
    expect(feed.cases).toHaveLength(1);
    expect(feed.cases[0]).toMatchObject({ employerName: "Employer 4", attorneyName: "Law firm 3" });
    expect(shown(feed.cases)).not.toMatch(/acme|widget|example law/i);
  });
});

describe("the case page's employer card", () => {
  it("shows the label for an older case's employer and still counts its years", async () => {
    answers.push(
      { match: /FROM perm_case_status WHERE/, answer: { columns: [], rows: [] } },
      { match: /FROM perm_cases WHERE case_number/, answer: { columns: [], rows: [] } },
      {
        match: /FROM perm_cases_history WHERE case_number/,
        answer: {
          columns: ["status", "received_date", "decision_date", "days", "employer_name", "employer_slug", "job_title", "soc_code", "soc_title", "state", "wage"],
          rows: [["certified", "2016-01-04", "2016-09-01", 241, "ACME WIDGETS MFG", "acme-widgets", "Engineer", null, null, "OH", 90000]],
        },
      },
      {
        match: /FROM perm_entities WHERE kind = 'employer'/,
        answer: {
          columns: ["name", "slug", "total", "certified", "denied", "median_days"],
          rows: [["Acme Widgets Inc", "acme-widgets", 30, 29, 1, 300]],
        },
      },
      {
        match: /FROM perm_employer_years WHERE slug/,
        answer: { columns: ["fy_from", "fy_to", "certified", "denied", "withdrawn"], rows: [[2009, 2026, 200, 4, 6]] },
      },
    );
    const { lookupCase } = await import("../caseLookup");
    const r = await lookupCase("A-16001-00001", { discover: false });
    expect(r?.decided?.employerName).toBe("Employer 4");
    expect(r?.employer).toMatchObject({ name: "Employer 4", slug: "employer-4", total: 210, fyFrom: 2009 });
    // The yearly table was asked by the real slug, rewritten from the neutral one the card carries.
    const years = execute.mock.calls.find(([s]) => /perm_employer_years/.test(s.sql))!;
    expect(years[0].args).toEqual(["acme-widgets"]);
    expect(shown(r)).not.toMatch(/acme|widget/i);
  });
});

describe("the seasonal case record", () => {
  it("masks the law firm and the employer on an H-2B application's published row", async () => {
    answers.push({
      match: /FROM seasonal_cases WHERE case_number/,
      answer: {
        columns: ["case_number", "case_status", "employer_name", "employer_slug", "soc_code", "naics", "attorney_name", "attorney_slug"],
        rows: [["H-400-25301-000123", "DETERMINATION ISSUED - CERTIFICATION", "ACME WIDGET CO", "acme-widget-co", "37-3011", "561730", "Example Law Group", "example-law-group"]],
      },
    });
    const { lookupSeasonalRecord } = await import("../seasonalCases");
    const r = await lookupSeasonalRecord("H-400-25301-000123");
    expect(r).toMatchObject({ employerName: "Employer 4", employerSlug: "employer-4", attorneyName: "Law firm 3", attorneySlug: "law-firm-3" });
    expect(shown(r)).not.toMatch(/acme|widget|example law/i);
  });
});
