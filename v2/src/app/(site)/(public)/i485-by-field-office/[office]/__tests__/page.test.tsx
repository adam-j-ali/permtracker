// @vitest-environment jsdom
/**
 * One USCIS office's page: USCIS's own counts for that office, said plainly, with nothing invented where the file
 * is silent (a withheld cell, an office the newest file doesn't list, a wait per office).
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OFFICE_LIST_OPENS_AT, toOfficeRow, type TimelineRecord } from "@/lib/communityTimeline";
import type { PlaceSummary, StepFigure } from "@/lib/reportedSummary";
import type { OfficeQuarter, OfficeRow } from "@/lib/uscisQuarterlyShape";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  // The medians' chart (ChartTips) opens a mark's link through the router.
  useRouter: () => ({ push: vi.fn() }),
}));
const getI485OfficeQuarters = vi.fn();
const getUscisPosted = vi.fn();
vi.mock("@/lib/db/uscisQuarterly", () => ({ getI485OfficeQuarters }));
const getPostedHistory = vi.fn(async () => [] as [string, number][]);
vi.mock("@/lib/db/uscisPosted", () => ({ getUscisPosted, getPostedHistory }));
vi.mock("@/components/data/DataProvenance", () => ({ DataProvenance: () => null }));
const queryStatic = vi.fn();
vi.mock("@/lib/convexStatic", () => ({ queryStatic }));
const getOfficeReportedCases = vi.fn();
const getReportedCasesBuiltAt = vi.fn(async () => Date.UTC(2026, 10, 19, 18, 16));
vi.mock("@/lib/db/communityReports", () => ({ getOfficeReportedCases, getReportedCasesBuiltAt }));
const getSampleMonths = vi.fn(async () => null as unknown);
vi.mock("@/lib/db/uscisSample", () => ({ getSampleMonths }));
// The office's figures over every source, the shared timelines among them (the hourly build's summary, D7).
const getOfficeSummary = vi.fn(async () => null as PlaceSummary | null);
vi.mock("@/lib/db/reportedSummary", () => ({ getOfficeSummary }));

const { default: UscisOfficePage, generateStaticParams, generateMetadata } = await import("../page");

const row = (code: string, office: string, state: string, emp: [number | null, number | null, number | null, number | null], fam = 100): OfficeRow =>
  ({
    state,
    office,
    code,
    suppressed: 0,
    empReceived: emp[0],
    empApproved: emp[1],
    empDenied: emp[2],
    empPending: emp[3],
    famPending: fam,
  }) as unknown as OfficeRow;

const quarter = (fy: number, q: number, end: string, rows: OfficeRow[]): OfficeQuarter => ({
  fy,
  quarter: q,
  quarterEnd: end,
  sourceFile: "i485_performance_data_fy2026_q3.xlsx",
  byCode: Object.fromEntries(rows.map((r) => [r.code, r])),
});

const QUARTERS = [
  quarter(2026, 2, "2026-03-31", [
    row("HAR", "Hartford", "Connecticut", [419, 460, 12, 1874]),
    row("BOS", "Boston", "Massachusetts", [900, 300, 20, 5000]),
    row("NBC", "National Benefits Center", "Service Center", [10, 9000, 50, 60000]),
  ]),
  quarter(2026, 3, "2026-06-30", [
    row("HAR", "Hartford", "Connecticut", [1118, 266, 18, 2699]),
    row("BOS", "Boston", "Massachusetts", [950, 310, null, 5200]),
    row("NBC", "National Benefits Center", "Service Center", [12, 9500, 60, 61000]),
  ]),
];
const POSTED = {
  published: "2026-10-19",
  newest: [{ form: "I-485", subtype: "131A", office: "FOD", posted: 9.5 }],
};

const page = async (office: string) => {
  const { container } = render(await UscisOfficePage({ params: Promise.resolve({ office }) }));
  return { container, text: (container.textContent ?? "").replace(/\s+/g, " ") };
};

/** What `communityTimelines.office` answers for these shared timelines, built with the backend's own rules. */
function sharedView(n: number) {
  const records = Array.from({ length: n }, (_, i) => ({
    public: true,
    status: "approved",
    updatedAt: Date.UTC(2026, 8, 1),
    i485FiledOn: "2025-05-01",
    biometricsOn: `2025-06-${String(10 + i).padStart(2, "0")}`,
    greenCardOn: "2026-02-20",
  })) as TimelineRecord[];
  const open = n >= OFFICE_LIST_OPENS_AT;
  return {
    total: n,
    shared: n,
    opensAt: OFFICE_LIST_OPENS_AT,
    open,
    capped: false,
    rows: open ? records.map(toOfficeRow) : [],
  };
}

beforeEach(() => {
  getI485OfficeQuarters.mockResolvedValue(QUARTERS);
  getUscisPosted.mockResolvedValue(POSTED);
  queryStatic.mockReset();
  queryStatic.mockResolvedValue(sharedView(0));
  getOfficeReportedCases.mockReset();
  getOfficeReportedCases.mockResolvedValue([]);
  getSampleMonths.mockReset();
  getSampleMonths.mockResolvedValue(null);
  getOfficeSummary.mockReset();
  getOfficeSummary.mockResolvedValue(null);
});

/** A case people reported at the San Fernando Valley office (src/lib/reportedCases.ts). */
const reportedCase = (n: number, transferDate: string, approvalDate: string | null, sources = ["sfv-filers"], maybeRepeats = 0) => ({
  id: `${sources[0]}:${n}`, sources, category: "EB-3", chargeability: "ROW", priorityDate: "2024-06-15", priorityNote: null,
  receiptDate: "2026-05-01", biometricsDate: "2026-05-20", transferDate, approvalDate, cardDate: null,
  visaAvailable: approvalDate ? null : true, status: "H1B", asOf: "2026-11-17", maybeRepeats,
});

describe("a USCIS office's page", () => {
  it("opens with the office's own counts and the day they're true for", async () => {
    const { container, text } = await page("hartford-connecticut");
    expect(container.querySelector("h1")?.textContent).toBe("I-485s at the Hartford field office");
    expect(text).toContain("On June 30, 2026, USCIS's field office in Hartford, Connecticut held 2,699 employment-based I-485s. It approved 266 in the three months before.");
  });

  it("lists its quarters newest first, and says where its pile stands among field offices", async () => {
    const { container, text } = await page("hartford-connecticut");
    const firstCells = [...container.querySelectorAll("#quarters tbody tr")].map((tr) => tr.querySelector("th")?.textContent?.trim());
    expect(firstCells).toEqual(["Apr to Jun 2026", "Jan to Mar 2026"]);
    // 2,699 pending against 266 + 18 decisions; Boston holds more, so Hartford is 2nd of the 2 field offices.
    expect(text).toContain("9.5 quarters of work at the quarter's pace of 284 decisions, and the 2nd largest of 2 field offices");
    expect(text).toContain("It isn't a wait for any one case.");
  });

  it("gives the one time USCIS posts for every field office, and says there's none for this office alone", async () => {
    const { text } = await page("hartford-connecticut");
    expect(text).toContain("9.5 months, as of its October 19, 2026 posting");
    expect(text).toContain("It posts no separate time for Hartford.");
  });

  it("gives this office's own family-based time and its history, and the papers an I-485 waits on", async () => {
    getPostedHistory.mockResolvedValueOnce([
      ["2022-03-14", 20],
      ["2025-10-20", 17],
      ["2026-10-19", 14.5],
    ]);
    getUscisPosted.mockResolvedValueOnce({
      ...POSTED,
      newest: [
        ...POSTED.newest,
        { form: "I-485", subtype: "131A-FAM", office: "HAR", posted: 14.5 },
        { form: "I-485", subtype: "131A-FAM", office: "BUF", posted: 10 },
        { form: "I-485", subtype: "131A-FAM", office: "CHI", posted: 18.5 },
        { form: "I-765", subtype: "147-C9", office: "NBC", posted: 12, label: "Based on a pending I-485 adjustment application [(c)(9)]", officeLabel: "National Benefits Center" },
        { form: "I-131", subtype: "141B-OTH", office: "SCD", posted: 26.5, label: "Advance parole", officeLabel: "Service Center Operations (SCOPS)" },
      ],
    });
    const { text } = await page("hartford-connecticut");
    expect(getPostedHistory).toHaveBeenCalledWith("I-485", "131A-FAM", "HAR");
    expect(text).toContain(
      "The one time USCIS posts for Hartford alone is for family-based I-485s: 14.5 months, as of its October 19, 2026 posting, down from 17 months in its October 20, 2025 posting. Of the 3 offices it posts that time for, one posts a shorter one.",
    );
    expect(text).toContain("Family-based, Hartford");
    expect(text).toContain(
      "While an I-485 waits, USCIS posts 12 months for a work permit based on it (I-765, category (c)(9), at the National Benefits Center) and 26.5 months for advance parole (I-131, at Service Center Operations (SCOPS)), as of its October 19, 2026 posting.",
    );
  });

  it("says nothing of an office's own time when USCIS posts none for it", async () => {
    const { text } = await page("hartford-connecticut");
    expect(text).not.toContain("alone is for family-based");
  });

  it("prints a withheld cell as withheld, never as a number", async () => {
    const { container } = await page("hartford-connecticut");
    expect(container.querySelectorAll("tbody td").length).toBeGreaterThan(0);
    const boston = await page("boston-massachusetts");
    const newestRow = boston.container.querySelector("tbody tr");
    expect(newestRow?.textContent).toContain("withheld");
    // With the denials withheld there's no pace to divide by, so no "quarters of work" is claimed.
    expect(boston.text).not.toContain("quarters of work");
  });

  it("answers the questions people ask about an office in its structured data", async () => {
    const { container } = await page("hartford-connecticut");
    const blocks = [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? "{}"));
    const faq = blocks.find((b) => b["@type"] === "FAQPage");
    expect(faq.mainEntity.map((q: { name: string }) => q.name)).toContain("How many employment-based I-485s are pending at the Hartford field office?");
    expect(JSON.stringify(faq)).toContain("2,699");
    const dataset = blocks.find((b) => b["@type"] === "Dataset");
    expect(dataset.dateModified).toBe("2026-06-30");
    expect(dataset.spatialCoverage.name).toBe("Hartford, Connecticut");
  });

  it("asks the backend for this office's shared timelines by USCIS's code, and links to them from the top", async () => {
    const { container, text } = await page("hartford-connecticut");
    expect(queryStatic.mock.calls[0]![1]).toEqual({ office: "HAR" });
    expect(container.querySelector('header a[href="#timelines"]')?.textContent).toBe("Timelines people shared from here");
    expect(container.querySelector("#timelines h2")?.textContent).toBe("Timelines people shared from the Hartford office");
    expect(text).toContain("Nobody has shared a timeline from the Hartford office yet.");
  });

  it("puts people's own timelines under USCIS's figures, and answers the wait question from every source as theirs", async () => {
    queryStatic.mockResolvedValue(sharedView(5));
    const gc: StepFigure = {
      id: "i485-gc", label: "I-485 filed to green card", group: "i485", verified: false, n: 12, windowDays: 365,
      median: 295, p25: 250, p75: 330, before: null, allTime: 20, months: [],
    };
    getOfficeSummary.mockResolvedValue({ today: "2026-11-25", cases: 30, steps: [gc] });
    const { container, text } = await page("hartford-connecticut");
    const section = container.querySelector("#timelines")!;
    expect(section.textContent).toContain("5 timelines");
    expect(section.querySelectorAll("tbody tr")).toHaveLength(5);
    // USCIS's own quarters come first on the page.
    expect(container.querySelector("#quarters")!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const faq = [...container.querySelectorAll('script[type="application/ld+json"]')].map((n) => n.textContent ?? "").find((t) => t.includes("FAQPage"))!;
    expect(faq).toContain("How long did people at the Hartford field office wait for their I-485?");
    expect(faq).toContain("The 12 people who reported a finished I-485 at the Hartford field office");
    expect(faq).toContain("report a median of 295 days from filing the I-485 to the green card, over the last 12 months.");
    expect(faq).toContain("self-reported");
    expect(text).toContain("Median 295 days");
    // The shared timelines work out no median of their own: the office's one figure is the summary's.
    expect(section.textContent).not.toContain("Median");
  });

  it("gives no median in the answer while the summary has none, and says the page shows one once five have shared", async () => {
    queryStatic.mockResolvedValue(sharedView(5));
    const { container } = await page("hartford-connecticut");
    const faq = [...container.querySelectorAll('script[type="application/ld+json"]')].map((n) => n.textContent ?? "").find((t) => t.includes("FAQPage"))!;
    expect(faq).toContain("it shows a median once five have");
    expect(faq).not.toMatch(/report a median/);
  });

  it("names a failed read of the timelines, and still shows USCIS's figures", async () => {
    queryStatic.mockRejectedValue(new Error("down"));
    const { text } = await page("hartford-connecticut");
    expect(text).toContain("The shared timelines can't be read right now.");
    expect(text).not.toContain("Nobody has shared");
    expect(text).toContain("held 2,699 employment-based I-485s");
  });

  it("says where a case is held only in USCIS's own words: a transfer notice, and the notice that names the office", async () => {
    const { text } = await page("hartford-connecticut");
    expect(text).toContain("USCIS says it sends a transfer notice when it moves a case, and an interview or appointment notice names the office to go to.");
    expect(text).not.toMatch(/online account (says|names)/);
  });

  it("names a center as a center and claims no field-office time for it", async () => {
    const { container, text } = await page("national-benefits-center");
    expect(container.querySelector("h1")?.textContent).toBe("I-485s at the National Benefits Center");
    expect(text).not.toContain("The processing time USCIS posts");
    expect(text).toContain("largest of 1 centers");
  });

  it("shows no figures for an office the newest file doesn't list", async () => {
    const { container, text } = await page("anchorage-alaska");
    expect(container.querySelector("h1")?.textContent).toBe("I-485s at the Anchorage field office");
    expect(container.querySelector("table")).toBeNull();
    expect(text).toContain("USCIS's newest quarterly file doesn't list the Anchorage field office");
  });

  it("is a page for every office in the list and for nothing else", async () => {
    expect(generateStaticParams()).toHaveLength(99);
    await expect(UscisOfficePage({ params: Promise.resolve({ office: "not-an-office" }) })).rejects.toThrow("NOT_FOUND");
    await expect(generateMetadata({ params: Promise.resolve({ office: "not-an-office" }) })).rejects.toThrow("NOT_FOUND");
  });

  it("lists the cases people reported for the office, each source credited, with each transfer day's count", async () => {
    getOfficeReportedCases.mockResolvedValue([
      reportedCase(1, "2026-06-06", "2026-07-26", ["sfv-filers", "reddit"]),
      reportedCase(2, "2026-06-06", "2026-07-16"),
      reportedCase(3, "2026-06-06", "2026-08-05"),
      reportedCase(4, "2026-09-24", null, ["reddit"], 1),
    ]);
    const { container, text } = await page("san-fernando-valley-california");
    expect(getOfficeReportedCases).toHaveBeenCalledWith("SFV");
    expect(text).toContain("Cases people reported here");
    expect(text).toContain(
      "4 employment-based I-485s at the San Fernando Valley field office, reported by the people themselves in the San Fernando Filers sheet and Reddit. 3 say they were approved.",
    );
    expect(text).toContain("Nothing here is checked");
    expect(text).toContain("counted once when three of its dates match");
    expect(text).toContain("4 cases people reported here");
    const cells = [...container.querySelectorAll("#reported-cases tbody tr")].map((r) => r.lastElementChild?.textContent?.trim());
    expect(cells).toContain("San Fernando Filers, Reddit");
    expect(cells).toContain("Reddit (may repeat another case)");
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent === "Open the San Fernando Filers sheet");
    expect(link?.getAttribute("href")).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/htmlview$/);
    expect(link?.getAttribute("target")).toBe("_blank");
    const june = [...container.querySelectorAll("tr")].find((r) => r.textContent?.startsWith("Jun 6, 2026"));
    expect(june?.textContent?.replace(/\s+/g, " ").trim()).toBe("Jun 6, 2026 3 3 50 0");
  });

  it("shows no reported-cases section for an office nobody reported", async () => {
    const { text } = await page("hartford-connecticut");
    expect(text).not.toContain("Cases people reported here");
    expect(text).not.toContain("cases people reported here");
  });

  it("says the reported cases can't be read when the read fails, never that there are none", async () => {
    getOfficeReportedCases.mockRejectedValue(new Error("connection reset"));
    const { text } = await page("san-fernando-valley-california");
    expect(text).toContain("The cases people reported here can't be read right now");
  });

  it("titles the page with the phrase people search and keeps it short", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ office: "hartford-connecticut" }) });
    expect(meta.title).toBe("Hartford USCIS Field Office Processing Times");
    const long = await generateMetadata({ params: Promise.resolve({ office: "charlotte-amalie-us-virgin-islands" }) });
    expect(String(long.title).length).toBeLessThanOrEqual(45);
    expect(meta.alternates?.canonical).toBe("/i485-by-field-office/hartford-connecticut");
  });

  describe("our USCIS sample's I-485 figure, on the six centers' pages", () => {
    const figure = (counted: number, share: number) => ({
      counted, walked_cases: 0, drawn_cases: counted, rest_unknown: false, rest_share: 1,
      groups: {
        approved: { count: Math.round(counted * share), estimated: 0, share, low: Math.max(0, share - 0.05), high: share + 0.05 },
        denied: { count: 0, estimated: 0, share: 0, low: 0, high: 0.1 }, withdrawn: { count: 0, estimated: 0, share: 0, low: 0, high: 0.1 },
        closed: { count: 0, estimated: 0, share: 0, low: 0, high: 0.1 }, revoked: { count: 0, estimated: 0, share: 0, low: 0, high: 0.1 },
        rfe: { count: 0, estimated: 0, share: 0, low: 0, high: 0.1 }, waiting: { count: 0, estimated: 0, share: 0, low: 0, high: 1 },
      },
    });
    const SAMPLE = {
      as_of: "2026-11-25",
      groups: [],
      by_month: {
        "2026-08": { "I-485": figure(60, 0.1) },
        "2026-09": { "I-485": figure(83, 0.012) },
        "2026-10": { "I-485": figure(4355, 0) },
        "2026-11": { "I-485": figure(47103, 0) },
      },
    };
    beforeEach(() => {
      getSampleMonths.mockReset();
      getSampleMonths.mockResolvedValue(SAMPLE);
    });

    it("shows the newest ended months with their margin and count, says it's online filings only, and links the blocks", async () => {
      const { container } = await page("national-benefits-center");
      const section = container.querySelector("#sample")!;
      const text = (section.textContent ?? "").replace(/\s+/g, " ");
      expect(section.querySelector("h2")?.textContent).toBe("Online I-485s approved so far, by the month filed");
      expect([...section.querySelectorAll("[data-source-kind]")].map((f) => f.getAttribute("data-source-kind"))).toEqual(["measured", "measured", "measured"]);
      expect(text).toContain("Filed in October 2026");
      expect(text).not.toContain("November 2026");
      expect(text).toContain("Margin 0% to 5%, from 4,355 cases checked.");
      expect(text).toContain("Online (IOE) I-485s only: paper filings aren't in the sample.");
      expect(text).toContain("not this center's alone");
      expect(section.querySelector('a[href="/uscis-receipt-blocks"]')).not.toBeNull();
    });

    it("leaves a field office's page without it, and never reads the sample there", async () => {
      const { container } = await page("hartford-connecticut");
      expect(container.querySelector("#sample")).toBeNull();
      expect(getSampleMonths).not.toHaveBeenCalled();
    });

    it("drops only its own section when the sample can't be read", async () => {
      getSampleMonths.mockRejectedValue(new Error("db down"));
      const { container, text } = await page("national-benefits-center");
      expect(container.querySelector("#sample")).toBeNull();
      expect(text).toContain("I-485s at the National Benefits Center");
    });
  });

  // Written by the inline literals before the move to getFAQPageSchema and datasetSchemaFor (Nov 25 2026), matched by
  // the helpers after it: the move changed how the nodes are written, never what they say.
  it.each(["hartford-connecticut", "national-benefits-center"])("renders the same JSON-LD through the shared helpers (%s)", async (slug) => {
    const { container } = await page(slug);
    const blocks = [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? "null"));
    await expect(JSON.stringify(blocks, null, 1)).toMatchFileSnapshot(`./__snapshots__/jsonld-${slug}.json`);
  });
});
