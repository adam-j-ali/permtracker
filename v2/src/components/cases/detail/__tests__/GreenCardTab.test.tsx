import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { GreenCardTab } from "../GreenCardTab";
import { StageProgress } from "../StageProgress";
import type { CaseDetailData } from "../case-detail-types";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => undefined),
  useMutation: vi.fn(() => vi.fn()),
}));

const caseData = (extra: Partial<CaseDetailData> = {}): CaseDetailData =>
  ({
    _id: "k577zsgc2hqkypgjp070hhnh458g4dyg",
    employerName: "Acme",
    positionTitle: "Engineer",
    caseStatus: "i485",
    progressStatus: "filed",
    eta9089FilingDate: "2023-08-01",
    i140ApprovalDate: "2024-09-01",
    ...extra,
  }) as unknown as CaseDetailData;

const LINE = {
  ok: true,
  line: {
    set: "employment",
    category: "EB2",
    country: "india",
    months: [
      { month: "2026-10", finalAction: "01JAN13", datesForFiling: "01JAN14" },
      { month: "2026-11", finalAction: "15JAN13", datesForFiling: "01FEB14" },
    ],
  },
};

/** Text that KeepWhole splits into pieces (it keeps "I-485" from breaking at its hyphen), matched whole. */
const whole = (text: string) => screen.getAllByText((_, el) => el?.textContent === text)[0]!;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(LINE), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GreenCardTab", () => {
  it("shows the path, the I-485's dates and receipts, the work permit and travel document, and the card", () => {
    render(
      <GreenCardTab
        caseData={caseData({
          greenCardPath: "adjustment",
          i485FilingDate: "2025-01-02",
          i485ReceiptNumber: "IOE0000000050",
          eadApprovalDate: "2025-05-01",
          cardReceivedDate: undefined,
        })}
      />,
    );
    expect(whole("Adjustment of status in the US (I-485)").closest("h2")).not.toBeNull();
    expect(whole("I-485 filed")).toBeInTheDocument();
    expect(screen.getAllByText(/IOE0000000050/).length).toBeGreaterThan(0);
    expect(whole("Work permit approved")).toBeInTheDocument();
    expect(whole("Card received")).toBeInTheDocument();
  });

  it("shows a denied I-485's date", () => {
    render(
      <GreenCardTab
        caseData={caseData({ greenCardPath: "adjustment", i485FilingDate: "2025-01-02", i485DenialDate: "2025-09-01", cardReceivedDate: undefined })}
      />,
    );
    expect(whole("I-485 denied")).toBeInTheDocument();
  });

  describe("how long the I-485 and the work permit take", () => {
    const FIGURES = {
      ok: true,
      steps: {
        i485: {
          official: { min: 9.5, max: 24, postedOn: "2026-11-03", where: "field offices" },
          measured: { asOf: "2026-11-24", months: [{ month: "2025-01", counted: 120, share: 0.31, low: 0.26, high: 0.36 }] },
          community: { median: 410, p25: 360, p75: 470, n: 37, windowDays: 365 },
        },
        ead: {
          official: { min: 12, max: 12, postedOn: "2026-11-03", where: "National Benefits Center" },
          measured: null,
          community: { median: null, p25: null, p75: null, n: 3, windowDays: null },
        },
      },
      unreadable: [],
    };
    const route = (estimates: Response | (() => Response)) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.startsWith("/api/step-estimates")
            ? typeof estimates === "function"
              ? estimates()
              : estimates
            : new Response(JSON.stringify(LINE), { status: 200 }),
        ),
      );

    it("shows the three kinds for each step, each named and marked with its kind", async () => {
      route(new Response(JSON.stringify(FIGURES), { status: 200 }));
      render(<GreenCardTab caseData={caseData({ greenCardPath: "adjustment", i485FilingDate: "2025-01-02" })} />);
      const card = await screen.findByRole("region", { name: "How long these steps take" });
      expect(await within(card).findAllByText("The agency")).toHaveLength(2);
      expect(within(card).getAllByText("Our count")).toHaveLength(2);
      expect(within(card).getAllByText("People's reports")).toHaveLength(2);
      const kinds = [...card.querySelectorAll("[data-source-kind]")].map((el) => el.getAttribute("data-source-kind"));
      expect(kinds).toEqual(["official", "measured", "community", "official", "measured", "community"]);
      expect(within(card).getByText("9.5 to 24 months")).toBeInTheDocument();
      expect(within(card).getByText(/the month yours was/)).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith("/api/step-estimates");
    });

    it("says the figures can't be read when the request fails", async () => {
      route(() => new Response("{}", { status: 503 }));
      render(<GreenCardTab caseData={caseData({ greenCardPath: "adjustment" })} />);
      const card = await screen.findByRole("region", { name: "How long these steps take" });
      expect(await within(card).findByText(/couldn.t be read just now/)).toBeInTheDocument();
    });

    it("isn't shown on the consular path", () => {
      route(new Response(JSON.stringify(FIGURES), { status: 200 }));
      render(<GreenCardTab caseData={caseData({ greenCardPath: "consular" })} />);
      expect(screen.queryByRole("region", { name: "How long these steps take" })).not.toBeInTheDocument();
    });
  });

  it("shows the consulate's steps on the consular path, and no I-485", () => {
    render(<GreenCardTab caseData={caseData({ greenCardPath: "consular", ds260SubmittedDate: "2025-02-01" })} />);
    expect(whole("Immigrant visa at a consulate abroad").closest("h2")).not.toBeNull();
    expect(whole("DS-260 submitted")).toBeInTheDocument();
    expect(screen.queryAllByText((_, el) => el?.textContent === "I-485 filed")).toEqual([]);
  });

  it("names the bulletin line from the category and the chargeability, and reads the priority date against it", async () => {
    render(
      <GreenCardTab caseData={caseData({ ebCategory: "EB-2", countryOfBirth: "IN", greenCardPath: "adjustment" })} />,
    );
    expect(whole("EB-2 India")).toBeInTheDocument();
    // The priority date (the ETA 9089's filing day, Aug 1 2023) against the November 2026 bulletin's charts.
    const card = await screen.findByRole("region", { name: "Visa bulletin line" });
    expect(await within(card).findByText(/Not current yet on the Final Action chart/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/bulletin-line?set=employment&category=EB2&country=india"));
  });

  it("asks for what the line needs when the category or country is missing", () => {
    render(<GreenCardTab caseData={caseData({ greenCardPath: "adjustment" })} />);
    expect(screen.getByText(/Add the preference category and the country of birth/)).toBeInTheDocument();
    // No line to read, so no bulletin is asked for (the step estimates are a read of their own).
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/bulletin-line"));
  });
});

describe("StageProgress past the I-140", () => {
  it("draws six steps, the path's own name fifth, the card last", () => {
    render(<StageProgress caseStatus="i485" path="adjustment" />);
    const steps = within(screen.getByRole("list", { name: "Case progress" })).getAllByRole("listitem");
    expect(steps).toHaveLength(6);
    expect(steps[4]).toHaveAttribute("aria-current", "step");
    expect(steps[4]).toHaveTextContent("I-485");
    expect(steps[3]).toHaveTextContent("Done:");
  });

  it("names the consulate on that path, and marks every step done once complete", () => {
    const { rerender } = render(<StageProgress caseStatus="consular" path="consular" />);
    expect(screen.getAllByRole("listitem")[4]).toHaveTextContent("Consulate");
    rerender(<StageProgress caseStatus="complete" path="consular" />);
    expect(screen.getAllByRole("listitem")[5]).toHaveAttribute("aria-current", "step");
  });
});
