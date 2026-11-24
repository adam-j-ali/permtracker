import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const pwdSummary = vi.fn();
const pwdLine = vi.fn();
const recordCounts = vi.fn();
const permLine = vi.fn();
const formMedian = vi.fn();
const monthly = vi.fn();
const consular = vi.fn();
const lca = vi.fn();
vi.mock("../pwdCases", () => ({ getPwdSummary: () => pwdSummary() }));
vi.mock("../pwdDayQueue", () => ({ getPwdLine: () => pwdLine() }));
vi.mock("../recordCounts", () => ({ getRecordCounts: () => recordCounts() }));
vi.mock("../permLine", () => ({ getPermLine: () => permLine() }));
vi.mock("../uscisQuarterly", () => ({ getUscisFormMedian: (form: string) => formMedian(form) }));
vi.mock("../uscisMonthly", () => ({ getUscisMonthly: () => monthly() }));
vi.mock("../consularPosts", () => ({ getConsularIndex: () => consular() }));
vi.mock("../lcaCases", () => ({ getLcaSummary: () => lca() }));

const { getOfficialHeadlines } = await import("../officialHeadlines");

describe("getOfficialHeadlines", () => {
  it("gives each step the agency's own figure, dated, from the reader its page uses", async () => {
    pwdSummary.mockResolvedValue({ pending: 30000, pendingByPrefix: { "P-100": 17098, "P-200": 9000 }, asOf: "2026-11-20T06:00:00Z" });
    pwdLine.mockResolvedValue({ day: "2026-08-14", filed: 700, decidedShare: 0.4, before: null, asOf: "2026-11-20", waitDays: 98 });
    recordCounts.mockResolvedValue([{ href: "/perm-case-status", value: 142000, label: "PERM cases pending at DOL", asOf: "2026-11-19", asOfKind: "checked" }]);
    permLine.mockResolvedValue({ month: "2025-10", total: 1, decided: 1, asOf: "2026-11-19" });
    formMedian.mockImplementation(async (form: string) => ({ form, medianMonths: form === "I-140" ? 6.1 : 2.3, quarterEnd: "2026-06-30" }));
    monthly.mockResolvedValue({ lines: [{ form: "I-485", line: "", basis: "Employment", points: [{ month: "2026-08", pending: 270000 }, { month: "2026-09", pending: 262000 }] }] });
    consular.mockResolvedValue({ asOf: "2026-11-01", posts: [{ now: { employment: { month: "2026-11" } } }, { now: { employment: { month: "2026-06" } } }] });
    lca.mockResolvedValue(null);
    const h = await getOfficialHeadlines(["pwd", "perm", "i140", "i485", "consular", "h1b"]);
    // PERM's own wage requests only: the H-1B ones wait in another line.
    expect(h.pwd).toMatchObject({ value: "17,098", href: "/pwd-cases", kind: "measured" });
    expect(h.pwd?.note).toContain("August 14, 2026");
    expect(h.perm).toMatchObject({ value: "142,000", href: "/perm-queue", kind: "measured" });
    expect(h.perm?.note).toContain("October 2025");
    expect(h.i140).toMatchObject({ value: "6.1 months", href: "/uscis-processing-times/i-140", kind: "official" });
    expect(h.i485).toMatchObject({ value: "262,000", kind: "official" });
    expect(h.i485?.note).toContain("September 2026");
    expect(h.consular?.value).toBe("1 of 2");
    expect(h.h1b).toMatchObject({ value: "2.3 months", href: "/uscis-processing-times/i-129", kind: "official" });
  });

  it("leaves out a step whose read failed or has no date, and keeps the rest", async () => {
    pwdSummary.mockRejectedValue(new Error("db down"));
    pwdLine.mockResolvedValue(null);
    recordCounts.mockResolvedValue([{ href: "/perm-case-status", value: 142000, label: "PERM cases pending at DOL", asOf: "", asOfKind: "checked" }]);
    permLine.mockResolvedValue(null);
    formMedian.mockResolvedValue({ form: "I-140", medianMonths: 6.1, quarterEnd: "2026-06-30" });
    const h = await getOfficialHeadlines(["pwd", "perm", "i140"]);
    expect(h.pwd).toBeUndefined();
    expect(h.perm).toBeUndefined();
    expect(h.i140?.value).toBe("6.1 months");
  });
});
