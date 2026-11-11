// @vitest-environment jsdom
/**
 * One USCIS office's page: USCIS's own counts for that office, said plainly, with nothing invented where the file
 * is silent (a withheld cell, an office the newest file doesn't list, a wait per office).
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OfficeQuarter, OfficeRow } from "@/lib/uscisQuarterlyShape";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
const getI485OfficeQuarters = vi.fn();
const getUscisPosted = vi.fn();
vi.mock("@/lib/db/uscisQuarterly", () => ({ getI485OfficeQuarters }));
vi.mock("@/lib/db/uscisPosted", () => ({ getUscisPosted }));
vi.mock("@/components/data/DataProvenance", () => ({ DataProvenance: () => null }));

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

beforeEach(() => {
  getI485OfficeQuarters.mockResolvedValue(QUARTERS);
  getUscisPosted.mockResolvedValue(POSTED);
});

describe("a USCIS office's page", () => {
  it("opens with the office's own counts and the day they're true for", async () => {
    const { container, text } = await page("hartford-connecticut");
    expect(container.querySelector("h1")?.textContent).toBe("I-485s at the Hartford field office");
    expect(text).toContain("On June 30, 2026, USCIS's field office in Hartford, Connecticut held 2,699 employment-based I-485s. It approved 266 in the three months before.");
  });

  it("lists its quarters newest first, and says where its pile stands among field offices", async () => {
    const { container, text } = await page("hartford-connecticut");
    const firstCells = [...container.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("th")?.textContent?.trim());
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
