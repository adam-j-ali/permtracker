import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DOL's FY2008 to FY2019 H-1B files bring an employer's older spellings onto its page (the employer map, through
 * `history_lca_spellings`), and an employer whose LCAs are all in them gets a page of its own. A withheld employer's
 * entry lists the spellings its page had when it was withheld, so an older spelling it doesn't list ("ACME ROBOTICS,
 * L.L.C.", printed in a FY2012 file, for an entry made as "Acme Robotics LLC") must still never print or link: not
 * on its page's record, not in the map's rows, not in a list. The masker reads every name and slug by its key too,
 * so the older spelling is masked through `rows()` like the listed one.
 *
 * Every name here is made up; the real lists live in server settings only.
 */

vi.mock("server-only", () => ({}));

const execute = vi.fn();
vi.mock("@libsql/client/http", () => ({
  createClient: () => ({ execute }),
}));

const EMPLOYERS = "acme-robotics-llc|Acme Robotics LLC|Employer||1||";
const OLDER_NAME = "ACME ROBOTICS, L.L.C.";
const OLDER_SLUG = "acme-robotics-l-l-c";

function answer(columns: string[], rows: unknown[][]) {
  return { columns, rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))), rowsAffected: 0 };
}

/** Every string a set of rows holds, so a test can say the older spelling is in none of them. */
function strings(rows: unknown[]): string[] {
  return rows.flatMap((r) => Object.values(r as Record<string, unknown>).filter((v): v is string => typeof v === "string"));
}

beforeEach(() => {
  vi.resetModules();
  execute.mockReset();
  process.env.DATABASE_URL = "libsql://test";
  process.env.DATABASE_AUTH_TOKEN = "t";
  process.env.WITHHELD_EMPLOYERS = EMPLOYERS;
  delete process.env.WITHHELD_FIRMS;
});

afterAll(() => {
  delete process.env.WITHHELD_EMPLOYERS;
});

describe("a withheld employer's older spelling", () => {
  it("is masked on the page record an older-files-only employer gets", async () => {
    const { rows } = await import("../client");
    // The sitemap's and the employer list's read of the pages with no PERM record, a rank window at a time.
    execute.mockResolvedValueOnce(
      answer(["slug", "name", "cases", "lca"], [[OLDER_SLUG, OLDER_NAME, 25, 25], ["prairie-labs-inc", "Prairie Labs Inc", 25, 25]]),
    );
    const got = await rows("SELECT slug, name, cases, lca FROM employer_other_index WHERE rank >= ? AND rank < ?", [1, 5000]);
    expect(strings(got)).not.toContain(OLDER_NAME);
    expect(strings(got)).not.toContain(OLDER_SLUG);
    expect(got[0]).toMatchObject({ slug: "employer-1", name: "Employer 1", cases: 25 });
    expect(got[1]).toMatchObject({ slug: "prairie-labs-inc", name: "Prairie Labs Inc" });
  });

  it("finds nothing when its old address is asked for, so the URL answers 404 and never leads to the neutral page", async () => {
    const { rows } = await import("../client");
    execute.mockResolvedValueOnce(answer(["slug", "name"], [[OLDER_SLUG, OLDER_NAME]]));
    expect(await rows("SELECT slug, name FROM employer_other_index WHERE slug = ?", [OLDER_SLUG])).toEqual([]);
  });

  it("never prints in the map's rows that tie it to its page", async () => {
    const { rows } = await import("../client");
    execute.mockResolvedValueOnce(
      answer(["source_slug", "page_slug", "page_kind"], [[OLDER_SLUG, "acme-robotics-llc", "other"]]),
    );
    const got = await rows("SELECT source_slug, page_slug, page_kind FROM employer_page_map WHERE page_kind = ?", ["other"]);
    expect(strings(got).filter((s) => s.includes("acme"))).toEqual([]);
  });

  it("never prints in an older LCA's row, the case search's and the employer page's lists", async () => {
    const { rows } = await import("../client");
    const cols = ["case_number", "employer_name", "employer_slug", "fiscal_year"];
    execute.mockResolvedValueOnce(answer(cols, [["I-200-12001-000001", OLDER_NAME, OLDER_SLUG, 2012]]));
    const got = await rows("SELECT case_number, employer_name, employer_slug, fiscal_year FROM lca_cases_history WHERE case_number = ?", [
      "I-200-12001-000001",
    ]);
    expect(got).toEqual([
      { case_number: "I-200-12001-000001", employer_name: "Employer 1", employer_slug: "employer-1", fiscal_year: 2012 },
    ]);
  });
});
