// @vitest-environment jsdom
/**
 * A USCIS form's page. What must hold here: the I-765 and I-131 pages lead with the row a pending I-485 waits on
 * (the (c)(9) work permit, advance parole), from USCIS's newest posting with its change over a year, and no other
 * form's page carries that sentence.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
