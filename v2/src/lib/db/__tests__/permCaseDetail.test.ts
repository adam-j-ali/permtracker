import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rows = vi.fn();
vi.mock("../client", () => ({ rows: (...a: unknown[]) => rows(...a) }));
vi.mock("@/lib/softRead", () => ({ softFail: (_label: string, fallback: unknown) => () => fallback }));

const { getPermCaseDetail } = await import("../permCaseDetail");

const JOB = { attorney_name: "Firm LLP", attorney_slug: "firm-llp", naics: "52399", worksite_city: "Merrimack", job_education: "Bachelor's", layoff: "N" };

describe("getPermCaseDetail", () => {
  beforeEach(() => rows.mockReset());

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

  it("says nothing when neither table holds the case, and never asks the older table after a failed read", async () => {
    rows.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await getPermCaseDetail("A-1")).toBeNull();
    rows.mockReset();
    rows.mockRejectedValueOnce(new Error("query deadline"));
    expect(await getPermCaseDetail("A-1")).toBeNull();
    expect(rows).toHaveBeenCalledTimes(1);
  });
});
