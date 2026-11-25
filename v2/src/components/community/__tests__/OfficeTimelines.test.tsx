import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OFFICE_LIST_OPENS_AT, toOfficeRow, type TimelineRecord } from "@/lib/communityTimeline";
import type { StepFigure } from "@/lib/reportedSummary";
import { officeByCode } from "@/lib/uscisOffices";

import { OfficeTimelines, type OfficeTimelineView } from "../OfficeTimelines";
import { htmlText } from "../../../../test-utils/text-content";

/**
 * "Timelines people shared from this office", on a USCIS office's page. What must hold: it says whose dates these
 * are; a failed read is named and never drawn as "nobody has shared"; rows show only when the read sent them; and
 * nothing that identifies a person or a case reaches the markup.
 */

const HAR = officeByCode("HAR")!;
const NBC = officeByCode("NBC")!;

const rec = (i: number, over: Partial<TimelineRecord> = {}): TimelineRecord =>
  ({
    public: true,
    status: "approved",
    updatedAt: Date.UTC(2026, 8, 1),
    fieldOffice: "HAR",
    category: "eb2",
    country: "india",
    i485FiledOn: "2025-05-01",
    biometricsOn: `2025-06-${String(10 + i).padStart(2, "0")}`,
    interviewOn: "2026-02-03",
    greenCardOn: "2026-02-20",
    ...over,
  }) as TimelineRecord;

function viewOf(records: TimelineRecord[]): OfficeTimelineView {
  const shared = records.filter((r) => r.public);
  const open = shared.length >= OFFICE_LIST_OPENS_AT;
  return {
    total: records.length,
    shared: shared.length,
    opensAt: OFFICE_LIST_OPENS_AT,
    open,
    capped: false,
    rows: open ? shared.map(toOfficeRow) : [],
  };
}

const html = (view: OfficeTimelineView | null, office = HAR) => renderToStaticMarkup(<OfficeTimelines office={office} view={view} />);

describe("OfficeTimelines", () => {
  it("names the office, says the dates are self-reported and checked, and gives the section its anchor", () => {
    const out = html(viewOf([]));
    expect(out).toContain('id="timelines"');
    expect(out).toContain("Timelines people shared from the Hartford office");
    expect(out).toMatch(/self-reported, and each timeline is checked before it shows/);
    expect(html(viewOf([]), NBC)).toContain("Timelines people shared from the National Benefits Center");
  });

  it("says nobody has shared yet when the read came back empty, and invites the first", () => {
    const out = html(viewOf([]));
    expect(out).toContain("Nobody has shared a timeline from the Hartford office yet. Yours would be the first.");
    expect(out).not.toContain("<table");
  });

  it("names a failed read as a failed read, never as an empty office", () => {
    const out = html(null);
    expect(out).toContain("can&#x27;t be read right now");
    expect(out).not.toContain("Nobody has shared");
  });

  it("keeps the rows shut below the floor and says how many are shared", () => {
    const out = html(viewOf([rec(0), rec(1, { public: false })]));
    expect(out).toContain("2 timelines");
    expect(out).toContain(`The list of rows opens at ${OFFICE_LIST_OPENS_AT} shared timelines, so no one row stands alone. 1 so far.`);
    expect(out).not.toContain("<table");
  });

  it("lists each row by its filing month and the days to each step, with no exact date", () => {
    const out = html(viewOf([rec(0), rec(1), rec(2, { rfeForm: "i485", rfeOutcome: "approved" })]));
    expect(out).toContain("<table");
    expect(out).toContain("May 2025");
    expect(out).toContain("40 days");
    expect(out).toContain("278 days");
    expect(out).toContain("295 days");
    expect(htmlText(out)).toContain("RFE on the I-485, approved after it");
    expect(out).toContain("EB-2");
    expect(out).toContain("India");
    expect(out).not.toContain("2025-05-01");
    expect(out).not.toContain("2026-02-20");
    expect(out).not.toMatch(/G-\d{3}-\d{5}/);
  });

  // The office's figures are the hourly build's (D7, Nov 25 2026): these timelines count in them with every other
  // source, and this section works out no median of its own.
  it("works out no median of its own, and lists the office's steps from the summary while none has a figure", () => {
    const view = viewOf(Array.from({ length: 5 }, (_, i) => rec(i)));
    const step = (id: string, label: string, allTime: number): StepFigure => ({
      id, label, group: "i485", verified: false, n: allTime, windowDays: null, median: null, p25: null, p75: null,
      before: null, allTime, months: [],
    });
    const listed = htmlText(renderToStaticMarkup(
      <OfficeTimelines office={HAR} view={view} steps={[step("i485-bio", "I-485 filed to biometrics", 3), step("i485-gc", "I-485 filed to green card", 0)]} />,
    ));
    expect(listed).not.toContain("Median");
    expect(listed).toContain("No step here has enough cases for a figure yet");
    expect(listed).toContain("I-485 filed to biometrics, 3 ever reported");
    expect(listed).toContain("I-485 filed to green card, none reported yet");
    const none = htmlText(renderToStaticMarkup(<OfficeTimelines office={HAR} view={view} steps={[]} />));
    expect(none).toContain("Too few cases from the Hartford office yet for a figure: each step needs 5.");
    // The page already shows the office's figures above: nothing about them here, and the list stays.
    const shown = htmlText(html(view));
    expect(shown).not.toMatch(/Median|enough cases|Too few cases/);
    expect(html(view)).toContain("Timelines shared from");
  });

  it("gives a step its month when the person left the I-485 date out", () => {
    const out = html(viewOf([rec(0, { i485FiledOn: undefined }), rec(1), rec(2)]));
    expect(out).toContain("Not given");
    expect(out).toContain("in Jun 2025");
  });
});
