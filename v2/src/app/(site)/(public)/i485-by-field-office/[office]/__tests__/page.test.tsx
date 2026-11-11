// @vitest-environment jsdom
/**
 * One USCIS office's page: USCIS's own counts for that office, said plainly, with nothing invented where the file
 * is silent (a withheld cell, an office the newest file doesn't list, a wait per office).
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeMetrics, OFFICE_LIST_OPENS_AT, OFFICE_METRIC_IDS, toOfficeRow, type TimelineRecord } from "@/lib/communityTimeline";
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
vi.mock("@/lib/db/uscisPosted", () => ({ getUscisPosted }));
vi.mock("@/components/data/DataProvenance", () => ({ DataProvenance: () => null }));
const queryStatic = vi.fn();
vi.mock("@/lib/convexStatic", () => ({ queryStatic }));

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
    metrics: computeMetrics(records).filter((m) => OFFICE_METRIC_IDS.includes(m.id)),
    rows: open ? records.map(toOfficeRow) : [],
  };
}

beforeEach(() => {
  getI485OfficeQuarters.mockResolvedValue(QUARTERS);
  getUscisPosted.mockResolvedValue(POSTED);
  queryStatic.mockReset();
  queryStatic.mockResolvedValue(sharedView(0));
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

  it("puts people's own timelines under USCIS's figures, and answers the wait question from them as theirs", async () => {
    queryStatic.mockResolvedValue(sharedView(5));
    const { container, text } = await page("hartford-connecticut");
    const section = container.querySelector("#timelines")!;
    expect(section.textContent).toContain("5 timelines");
    expect(section.querySelectorAll("tbody tr")).toHaveLength(5);
    // USCIS's own quarters come first on the page.
    expect(container.querySelector("#quarters")!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const faq = [...container.querySelectorAll('script[type="application/ld+json"]')].map((n) => n.textContent ?? "").find((t) => t.includes("FAQPage"))!;
    expect(faq).toContain("How long did people at the Hartford field office wait for their I-485?");
    expect(faq).toContain("The 5 people who shared a full timeline from the Hartford field office report a median of 295 days from filing the I-485 to the green card.");
    expect(faq).toContain("self-reported");
    expect(text).toContain("Median 295 days");
  });

  it("gives no median in the answer below five timelines, and says the page shows one once five have shared", async () => {
    queryStatic.mockResolvedValue(sharedView(3));
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

  it("titles the page with the phrase people search and keeps it short", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ office: "hartford-connecticut" }) });
    expect(meta.title).toBe("Hartford USCIS Field Office I-485 Numbers");
    const long = await generateMetadata({ params: Promise.resolve({ office: "charlotte-amalie-us-virgin-islands" }) });
    expect(String(long.title).length).toBeLessThanOrEqual(45);
    expect(meta.alternates?.canonical).toBe("/i485-by-field-office/hartford-connecticut");
  });
});
