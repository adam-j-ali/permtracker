import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DecisionMonths } from "../DecisionMonths";
import type { MonthAgainst } from "@/lib/decisionMonths";

const months: MonthAgainst[] = [
  {
    month: "2026-11", toDate: true, gap: null, afterShutdown: true, perDayPct: 37,
    now: { total: 4806, workdays: 7, from: "2026-11-01", to: "2026-11-11", source: "checks" },
    then: { total: 3000, workdays: 6, from: "2025-11-01", to: "2025-11-11", source: "file" },
  },
  {
    month: "2026-10", toDate: false, gap: "shutdown", afterShutdown: false, perDayPct: null,
    now: { total: 15169, workdays: 21, from: "2026-10-01", to: "2026-10-31", source: "checks" },
    then: { total: 21, workdays: 0, from: "2025-10-01", to: "2025-10-31", source: "file" },
  },
  {
    month: "2026-08", toDate: false, gap: "part-month", afterShutdown: false, perDayPct: null,
    now: { total: 1200, workdays: 2, from: "2026-08-28", to: "2026-08-31", source: "checks" },
    then: { total: 900, workdays: 1, from: "2025-08-28", to: "2025-08-31", source: "file" },
  },
  { month: "2026-07", toDate: false, gap: "not-counted", afterShutdown: false, perDayPct: null, now: null, then: null },
  {
    month: "2026-06", toDate: false, gap: null, afterShutdown: false, perDayPct: -12,
    now: { total: 9000, workdays: 21, from: "2026-06-01", to: "2026-06-30", source: "file" },
    then: { total: 9800, workdays: 20, from: "2025-06-01", to: "2025-06-30", source: "file" },
  },
];

describe("decisions by month, against a year earlier", () => {
  it("puts each month beside the same days a year earlier, with the change per working day", () => {
    render(<DecisionMonths months={months} />);
    expect(screen.getByRole("heading", { level: 2, name: "Decisions by month, against a year earlier" })).toBeTruthy();
    const table = screen.getByRole("table", { name: /PERM decisions each month/ });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(6);
    const nov = rows[1]!.textContent ?? "";
    expect(nov).toContain("November 2026");
    // The short month too, for a phone's four columns.
    expect(nov).toContain("Nov 2026");
    expect(nov).toContain("through Nov 11");
    expect(nov).toContain("4,806");
    expect(nov).toContain("7 workdays");
    expect(nov).toContain("3,000");
    expect(nov).toContain("6 workdays");
    expect(nov).toContain("37% more");
    expect(nov).toContain("DOL had just reopened");
    expect(rows[5]!.textContent).toContain("12% fewer");
  });

  it("names the shutdown and gives it no percent", () => {
    render(<DecisionMonths months={months} />);
    const oct = within(screen.getByRole("table")).getAllByRole("row")[2]!.textContent ?? "";
    expect(oct).toContain("15,169");
    expect(oct).toContain("21");
    expect(oct).toContain("DOL was shut");
    expect(oct).not.toMatch(/%/);
    // The cell is short; the note under the table says it in full.
    expect(document.body.textContent).toContain("thousands of decisions against a handful is a closed office");
  });

  it("says a part month and a month not counted yet, in words", () => {
    render(<DecisionMonths months={months} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[3]!.textContent).toContain("from Aug 28");
    expect(rows[3]!.textContent).toContain("part month");
    expect(rows[4]!.textContent).toContain("not counted yet");
    expect(rows[4]!.textContent).toContain("not compared");
  });

  it("says where the newest months come from, and links DOL's notice of the shutdown", () => {
    render(<DecisionMonths months={months} checksFrom="2026-08-27" />);
    // The first day of our check is read from the record, never typed: the August row above starts on the same day.
    expect(document.body.textContent).toContain("Our daily check's first day is August 27, 2026, so the weeks between");
    expect(document.body.textContent).toContain("our daily check of DOL's case status, until DOL publishes them");
    const notice = screen.getByRole("link", { name: "DOL's notice" });
    expect(notice.getAttribute("target")).toBe("_blank");
    expect(notice.getAttribute("href")).toMatch(/^https:\/\/www\.dol\.gov\//);
  });

  it("draws nothing with no months", () => {
    const { container } = render(<DecisionMonths months={[]} />);
    expect(container.textContent).toBe("");
  });
});
