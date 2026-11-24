import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OFFICE_LIST_OPENS_AT, SIDE_METRIC_IDS, computeMetrics, OFFICE_METRIC_IDS, toBoardRow, toOfficeRow, type TimelineRecord } from "@/lib/communityTimeline";
import { officeByCode } from "@/lib/uscisOffices";

import { OfficeTimelines } from "../OfficeTimelines";
import { BoardTable, StageMedians, h4Text } from "../TimelineBoard";
import { textContent } from "../../../../test-utils/text-content";

/** A row's H-4 papers in words, durations only, kept apart from the lines around them. */
const rec = (over: Partial<TimelineRecord>): TimelineRecord => ({ public: true, updatedAt: Date.UTC(2026, 10, 1), ...over });
/** The cell's text as a reader gets it: tags out, runs of space as one, the way a page collapses them. */
const text = (html: string) => {
  const box = document.createElement("div");
  box.innerHTML = html;
  return (box.textContent ?? "").replace(/\s+/g, " ");
};

describe("the H-4 line", () => {
  it("says each approved paper's days, and filed with the I-539 only for the work permit", () => {
    expect(h4Text({ extensionDays: 181, workPermitDays: 162, together: true })).toBe("H-4 extension in 181 days, H-4 work permit in 162 days, filed with the I-539");
    expect(h4Text({ extensionDays: null, workPermitDays: 1, together: false })).toBe("H-4 work permit in 1 day");
    expect(h4Text({ extensionDays: 30, workPermitDays: null, together: false })).toBe("H-4 extension in 30 days");
  });

  it("sits in a board row with a space on each side, never glued to its neighbours", () => {
    const row = toBoardRow(
      rec({
        permFiledOn: "2025-01-10",
        route: "adjustment",
        premium: true,
        applicant: "dependent",
        i140FiledOn: "2025-09-01",
        h4FiledOn: "2026-01-01",
        h4ApprovedOn: "2026-07-01",
        h4EadFiledOn: "2026-01-01",
        h4EadApprovedOn: "2026-06-12",
      }),
    );
    const out = text(renderToStaticMarkup(<BoardTable rows={[row]} />));
    expect(out).toContain("Adjusting status in the US premium I-140 a dependent's case H-4 extension in 181 days, H-4 work permit in 162 days, filed with the I-539 ");
    expect(out).not.toContain("2026-06-12");
  });
});

describe("the H-4 line on an office's list", () => {
  it("follows the row's other lines with a space between", () => {
    const records = Array.from({ length: OFFICE_LIST_OPENS_AT }, (_, i) =>
      rec({ i485FiledOn: "2025-05-01", biometricsOn: `2025-06-1${i}`, fieldOffice: "HAR", h4EadFiledOn: "2025-03-01", h4EadApprovedOn: "2025-09-01" }),
    );
    const view = {
      total: records.length,
      shared: records.length,
      opensAt: OFFICE_LIST_OPENS_AT,
      open: true,
      capped: false,
      metrics: computeMetrics(records).filter((m) => OFFICE_METRIC_IDS.includes(m.id)),
      rows: records.map(toOfficeRow),
      codes: [],
    };
    const out = text(renderToStaticMarkup(<OfficeTimelines office={officeByCode("HAR")!} view={view} />));
    expect(out).toContain("H-4 work permit in 184 days ");
    expect(out).not.toContain("2025-09-01");
  });
});

describe("the empty state's list of stages", () => {
  it("numbers only the steps in their order, and lists RFEs and the H-4 beside them without numbers", () => {
    render(<StageMedians metrics={computeMetrics([])} />);
    const lists = screen.getAllByRole("list");
    const steps = within(lists[0]!).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(steps.some((t) => /H-4|RFE/.test(t))).toBe(false);
    expect(steps[0]).toMatch(/^1\s?PERM filed to certified/);
    expect(screen.getByText(textContent("Beside the case: RFEs and a spouse's H-4"))).toBeTruthy();
    const side = within(lists[1]!).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(side).toHaveLength(SIDE_METRIC_IDS.length);
    expect(side.every((t) => !/^\d/.test(t.trim()))).toBe(true);
    expect(side.join(" ")).toContain("H-4 work permit filed on its own, filed to approved");
  });
});
