// @vitest-environment jsdom
/**
 * A USCIS form's page. What must hold here: the I-765 and I-131 pages lead with the row a pending I-485 waits on
 * (the (c)(9) work permit, advance parole), from USCIS's newest posting with its change over a year, and no other
 * form's page carries that sentence.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/time", async (orig) => ({ ...(await orig<typeof import("@/lib/time")>()), easternDay: () => "2026-11-18" }));
const getUscisFormRows = vi.fn(async () => []);
const getHistoricalMedians = vi.fn(async () => null);
vi.mock("@/lib/db/uscisQuarterly", () => ({ getUscisFormRows, getHistoricalMedians }));
const getUscisPosted = vi.fn();
const getPostedHistory = vi.fn(async () => [] as [string, number][]);
vi.mock("@/lib/db/uscisPosted", () => ({ getUscisPosted, getPostedHistory }));
vi.mock("@/components/data/DataProvenance", () => ({ DataProvenance: () => null }));
const getUscisMonthly = vi.fn(async () => null as unknown);
vi.mock("@/lib/db/uscisMonthly", () => ({ getUscisMonthly }));
const getReportedI140Cases = vi.fn(async () => [] as unknown[]);
vi.mock("@/lib/db/communityReports", () => ({ getReportedI140Cases }));

const { default: UscisFormPage } = await import("../page");

const row = (form: string, subtype: string, office: string, posted: number, label: string, officeLabel: string) => ({
  form, subtype, office, posted, postedText: null, requestDate: null, label, officeLabel,
});
const POSTED = {
  published: "2026-10-19",
  postings: ["2026-10-19"],
  series: [],
  longestGapDays: 34,
  project: "https://github.com/jzebedee/uscis",
  newest: [
    row("I-765", "147-C9", "NBC", 12, "Based on a pending I-485 adjustment application [(c)(9)]", "National Benefits Center"),
    row("I-131", "141B-OTH", "SCD", 26.5, "Advance parole", "Service Center Operations (SCOPS)"),
  ],
};

const page = async (form: string) => {
  const { container } = render(await UscisFormPage({ params: Promise.resolve({ form }) }));
  return (container.textContent ?? "").replace(/\s+/g, " ");
};

beforeEach(() => {
  getReportedI140Cases.mockReset();
  getReportedI140Cases.mockResolvedValue([]);
  getUscisMonthly.mockReset();
  getUscisMonthly.mockResolvedValue(null);
  getUscisPosted.mockReset();
  getPostedHistory.mockReset();
  getUscisPosted.mockResolvedValue(POSTED);
  getPostedHistory.mockResolvedValue([]);
});

describe("the row a pending I-485 waits on, first", () => {
  it("gives the (c)(9) work permit at the National Benefits Center, and how it moved in a year", async () => {
    getPostedHistory.mockResolvedValueOnce([
      ["2022-03-14", 5],
      ["2025-10-20", 9.5],
      ["2026-10-19", 12],
    ]);
    const text = await page("i-765");
    expect(getPostedHistory).toHaveBeenCalledWith("I-765", "147-C9", "NBC");
    expect(text).toContain(
      "For a work permit based on a pending I-485 (category (c)(9)), USCIS posts 12 months at the National Benefits Center as of its October 19, 2026 posting, up from 9.5 months in its October 20, 2025 posting. That's the time within which it decided 8 cases in 10. Every posting since March 14, 2022",
    );
  });

  it("gives advance parole on the I-131 page, and leaves the change out without a year of history", async () => {
    getPostedHistory.mockResolvedValueOnce([
      ["2026-05-04", 22],
      ["2026-10-19", 26.5],
    ]);
    const text = await page("i-131");
    expect(getPostedHistory).toHaveBeenCalledWith("I-131", "141B-OTH", "SCD");
    expect(text).toContain(
      "For advance parole, USCIS posts 26.5 months at Service Center Operations (SCOPS) as of its October 19, 2026 posting. That's the time",
    );
  });

  it("puts no such sentence on another form's page, and reads no history for it", async () => {
    const text = await page("i-485");
    expect(text).not.toContain("For a work permit based on");
    expect(text).not.toContain("For advance parole");
    expect(getPostedHistory).not.toHaveBeenCalled();
  });

  it("drops the sentence when USCIS's newest posting is too old to stand for now", async () => {
    getUscisPosted.mockResolvedValue({ ...POSTED, published: "2026-06-01", postings: ["2026-06-01"] });
    const text = await page("i-765");
    expect(text).not.toContain("For a work permit based on");
  });
});

const pt = (month: string, approved: number, denied: number, pending: number) => ({
  month, received: 17190, approved, denied, pending, pending_6mo: 155350, avg_months: 12.9,
});
const MONTHLY = {
  newest: "2026-09",
  months: ["2026-07", "2026-09"],
  missing: ["2026-08"],
  source: "USCIS",
  lines: [
    { form: "I-485", line: "Adjust Status (Employment)", basis: "Employment", points: [pt("2026-07", 12927, 1169, 269963), pt("2026-09", 8068, 1497, 278532)] },
    { form: "I-485", line: "Adjust Status (Family)", basis: "Family", points: [pt("2026-09", 26428, 5903, 609857)] },
  ],
};

describe("USCIS's monthly report to Congress, on a form it covers", () => {
  it("answers the newest month first, then lists each month, a month it doesn't list as its own row", async () => {
    getUscisMonthly.mockResolvedValue(MONTHLY);
    const text = await page("i-485");
    expect(text).toContain(
      "In September 2026, USCIS decided 9,565 employment-based I-485s: 8,068 approved and 1,497 denied (16%). 278,532 were pending at the month's end, and 155,350 of them had waited more than six months.",
    );
    // Too few months a year earlier to compare, and too few to draw: neither is shown.
    expect(text).not.toContain("a month it decided on average");
    expect(text).not.toContain("USCIS decided each month, approved and denied");
    expect(text).toContain("Each month, as USCIS reports it to Congress");
    expect(text).toContain("September 2026 17,190 8,068 1,497 16% 278,532 155,350 12.9");
    expect(text).toContain("August 2026 USCIS's data page doesn't list this month's report.");
    // Every basis in the newest month, the largest pile first.
    expect(text.indexOf("Family 17,190 26,428")).toBeGreaterThan(-1);
    expect(text.indexOf("Family 17,190")).toBeLessThan(text.indexOf("Employment 17,190"));
    expect(text).toContain("USCIS says it may differ from the processing times it posts");
  });

  it("sets the newest month against the year before, over the months USCIS reported (the N-400 drop, Nov 2026)", async () => {
    const months: string[] = [];
    for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
    const held = months.filter((m) => m >= "2024-11" && m <= "2026-09");
    getUscisMonthly.mockResolvedValue({
      newest: "2026-09", months: held, missing: [], source: "USCIS",
      lines: [{
        form: "N-400", line: "Application for Naturalization", basis: "",
        points: held.map((m) => (m === "2026-09" ? pt(m, 19187, 4227, 842677) : m === "2025-09" ? pt(m, 71181, 7198, 537769) : pt(m, 74000, 8000, 600000))),
      }],
    });
    const text = await page("n-400");
    expect(text).toContain("In September 2026, USCIS decided 23,414 N-400s: 19,187 approved and 4,227 denied (18%).");
    // Oct 2024 to Sep 2025: October 2024 isn't held, so 11 months count; (10 x 82,000 + 78,379) / 11 = 81,671.
    expect(text).toContain("That's 29% of the 81,671 a month it decided on average from October 2024 to September 2025, over the 11 months it reported.");
    // Every month held is drawn, with its figures for a screen reader.
    expect(text).toContain("N-400s USCIS decided each month, approved and denied, from its monthly report to Congress");
    expect(text).toContain("November 2024 74,000 8,000");
    expect(text).toContain("842,677 were pending at the month's end, against 537,769 a year earlier");
  });

  it("says nothing of it on a form the report doesn't cover", async () => {
    getUscisMonthly.mockResolvedValue(MONTHLY);
    const text = await page("i-140");
    expect(text).not.toContain("as USCIS reports it to Congress");
  });
});

describe("the I-140s people reported, on the I-140's page", () => {
  const niw = (n: number, premium: string | null = "with filing") => ({
    category: "EB-2 NIW", premium, filed: "2026-01-01", decision: n === 5 ? "denied" : "approved",
    decided: `2026-02-${String(n + 9).padStart(2, "0")}`, rfe: n === 1 ? "rfe" : "none",
  });

  const quarter = { fy: 2026, quarter: 3, quarterEnd: "2026-06-30", title: "Immigrant Petition for Alien Workers",
    received: 30000, approved: 25000, denied: 2000, completed: 27000, pending: 80000, medianMonths: 4.1 };
  beforeEach(() => getUscisFormRows.mockResolvedValue([quarter] as never));
  afterEach(() => getUscisFormRows.mockResolvedValue([]));

  it("shows the median days by category and premium, credited, and says nothing in it is checked", async () => {
    getReportedI140Cases.mockResolvedValue([1, 2, 3, 4, 5].map((n) => niw(n)));
    const text = await page("i-140");
    expect(getReportedI140Cases).toHaveBeenCalled();
    expect(text).toContain("What people reported about their own I-140s");
    expect(text).toContain("5 I-140s people reported themselves, 5 of them decided");
    expect(text).toContain("Nothing here is checked");
    expect(text).toContain("EB-2 NIW, premium from filing");
    expect(text).toContain("42 days");
    expect(text).toContain("80% approved, 20% got an RFE or a NOID");
  });

  it("reads nothing and shows nothing on another form's page", async () => {
    const text = await page("i-485");
    expect(getReportedI140Cases).not.toHaveBeenCalled();
    expect(text).not.toContain("What people reported about their own I-140s");
  });

  it("loses only its own section when the read fails", async () => {
    getReportedI140Cases.mockRejectedValue(new Error("connection reset"));
    const text = await page("i-140");
    expect(text).not.toContain("What people reported about their own I-140s");
    expect(text).toContain("Median months, quarter by quarter");
  });
});
