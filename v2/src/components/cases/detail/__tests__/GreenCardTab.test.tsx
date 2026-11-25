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
          i485ReceiptNumber: "IOE0912345678",
          eadApprovalDate: "2025-05-01",
          cardReceivedDate: undefined,
        })}
      />,
    );
    expect(whole("Adjustment of status in the US (I-485)").closest("h2")).not.toBeNull();
    expect(whole("I-485 filed")).toBeInTheDocument();
    expect(screen.getAllByText(/IOE0912345678/).length).toBeGreaterThan(0);
    expect(whole("Work permit approved")).toBeInTheDocument();
    expect(whole("Card received")).toBeInTheDocument();
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
    expect(fetch).not.toHaveBeenCalled();
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
