import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rows = vi.fn();
vi.mock("../client", () => ({ rows: (...a: unknown[]) => rows(...a) }));
vi.mock("@/lib/softRead", () => ({ softFail: (_label: string, fallback: unknown) => () => fallback }));
const linkable = vi.fn();
vi.mock("../entityLinks", () => ({ linkableSlugs: (...a: unknown[]) => linkable(...a) }));

const { getPermCaseDetail } = await import("../permCaseDetail");

const JOB = { attorney_name: "Firm LLP", attorney_slug: "firm-llp", naics: "52399", worksite_city: "Merrimack", job_education: "Bachelor's", layoff: "N" };

describe("getPermCaseDetail", () => {
  beforeEach(() => {
    rows.mockReset();
    linkable.mockReset();
    linkable.mockResolvedValue(new Set(["firm-llp"]));
  });

  it("reads the current files' table and its wage request's level and requirements", async () => {
    rows
      .mockResolvedValueOnce([{ ...JOB, pwd_number: "P-100-24320-478060" }])
      .mockResolvedValueOnce([{ wage_level: "IV", req_education: "Bachelor's", req_experience_months: "60" }]);
    const got = await getPermCaseDetail("G-100-25318-409609");
    expect(got).toMatchObject({ attorneySlug: "firm-llp", layoff: false, pwdNumber: "P-100-24320-478060", pwd: { level: "IV", experienceMonths: 60 } });
    expect(rows.mock.calls[0]![0]).toContain("FROM perm_cases WHERE");
    expect(rows.mock.calls[1]![0]).toContain("FROM pwd_cases WHERE");
  });

  it("falls back to the FY2020 to FY2023 table, which has the job fields but no wage request number", async () => {
    rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...JOB, layoff: "Y" }]);
    const got = await getPermCaseDetail("A-20123-45678");
    expect(rows.mock.calls[1]![0]).toContain("FROM perm_cases_history WHERE");
    expect(rows.mock.calls[1]![0]).not.toContain("pwd_number");
    expect(got).toMatchObject({ attorneyName: "Firm LLP", worksiteCity: "Merrimack", layoff: true, pwdNumber: null, pwd: null });
  });

  it("links an older case's firm only to a page that exists: a firm with no page carries its own name's slug", async () => {
    rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...JOB, attorney_name: "Quiet Group PC", attorney_slug: "quiet-group-pc" }]);
    linkable.mockResolvedValueOnce(new Set());
    const got = await getPermCaseDetail("A-17001-00001");
    expect(linkable).toHaveBeenCalledWith("attorney", ["quiet-group-pc"]);
    expect(got).toMatchObject({ attorneyName: "Quiet Group PC", attorneySlug: null });
  });

  it("keeps an older case's firm link when its page exists, or when the page check fails", async () => {
    rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...JOB }]);
    expect(await getPermCaseDetail("A-17001-00002")).toMatchObject({ attorneySlug: "firm-llp" });
    rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...JOB }]);
    linkable.mockRejectedValueOnce(new Error("query deadline"));
    expect(await getPermCaseDetail("A-17001-00003")).toMatchObject({ attorneySlug: "firm-llp" });
  });

  it("asks nothing more for a current case, whose slug is always a page's", async () => {
    rows
      .mockResolvedValueOnce([{ ...JOB, pwd_number: null }]);
    await getPermCaseDetail("G-100-25318-409609");
    expect(linkable).not.toHaveBeenCalled();
  });

  it("says nothing when neither table holds the case, and never asks the older table after a failed read", async () => {
    rows.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await getPermCaseDetail("A-1")).toBeNull();
    rows.mockReset();
    rows.mockRejectedValueOnce(new Error("query deadline"));
    expect(await getPermCaseDetail("A-1")).toBeNull();
    expect(rows).toHaveBeenCalledTimes(1);
  });
});
