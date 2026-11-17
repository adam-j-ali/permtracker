import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DecisionPeriods } from "../DecisionPeriods";
import type { ActivityDay } from "@/lib/activityStats";
import { decisionViews } from "@/lib/decisionPeriods";

/**
 * The decisions chart: one switch for days, weeks, months and years, each against a year earlier, the usual shape of
 * the span beside it, and on the decisions page every period listed under it. The numbers are src/lib/decisionPeriods.ts's
 * (held by its own tests); these hold what a reader sees and can do.
 */
const d = (date: string, total: number): ActivityDay => ({ date, total, certified: total, denied: 0, withdrawn: 0 });
function weekdays(from: string, to: string, total: number): ActivityDay[] {
  const out: ActivityDay[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) out.push(d(new Date(t).toISOString().slice(0, 10), total));
  }
  return out;
}
// DOL's file through June 2026 with the shutdown's hole; our check from Friday August 28, 2026.
const views = decisionViews(
  [...weekdays("2024-10-01", "2025-09-30", 500), d("2025-10-02", 21), ...weekdays("2025-11-03", "2026-06-30", 500)],
  weekdays("2026-08-28", "2026-11-12", 700),
  "2026-11-12",
);

const pick = (name: string) =>
  fireEvent.click(within(screen.getByRole("group", { name: "Count decisions by" })).getByRole("button", { name }));
const rows = () => within(screen.getByRole("table", { name: /PERM decisions each/ })).getAllByRole("row");

afterEach(() => {
  window.location.hash = "";
});

describe("the decisions chart", () => {
  it("opens on the days, with the four choices and the year-earlier marks on", () => {
    render(<DecisionPeriods views={views} table />);
    const group = screen.getByRole("group", { name: "Count decisions by" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Days", "Weeks", "Months", "Years"]);
    expect(within(group).getByRole("button", { name: "Days" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Mark the same days a year earlier" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("The last 30 days")).toBeTruthy();
    expect(screen.getByText("A typical week")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Each day against a year earlier" })).toBeTruthy();
  });

  it("says when the day a year earlier, not this one, was the holiday", () => {
    render(<DecisionPeriods views={views} table />);
    const tue = rows().find((r) => r.textContent?.includes("Tue, Nov 10, 2026"))!;
    expect(tue.textContent).toContain("a holiday a year earlier");
    const wed = rows().find((r) => r.textContent?.includes("Wed, Nov 11, 2026"))!;
    expect(wed.textContent).not.toContain("a year earlier");
  });

  it("lists each month beside the same days a year earlier, with the change per working day", () => {
    render(<DecisionPeriods views={views} table />);
    pick("Months");
    expect(screen.getByText("The last 12 months")).toBeTruthy();
    expect(screen.getByText("A typical year")).toBeTruthy();
    const all = rows();
    expect(all).toHaveLength(13);
    const nov = all[1]!.textContent ?? "";
    expect(nov).toContain("November 2026");
    // The short month too, for a phone's four columns.
    expect(nov).toContain("Nov 2026");
    expect(nov).toContain("through Nov 11");
    // Eight rows of 700 over seven working days, against seven of 500 over six.
    expect(nov).toContain("5,600");
    expect(nov).toContain("7 workdays");
    expect(nov).toContain("3,500");
    expect(nov).toContain("6 workdays");
    expect(nov).toContain("37% more");
    expect(nov).toContain("DOL had just reopened");
  });

  it("names the shutdown, a part month and a month not counted yet, in words, with no percent", () => {
    render(<DecisionPeriods views={views} table />);
    pick("Months");
    const all = rows();
    const oct = all[2]!.textContent ?? "";
    expect(oct).toContain("DOL was shut");
    expect(oct).not.toMatch(/%/);
    // November, October, September, then August (our check joined on the 28th) and July (neither record holds it).
    expect(all[4]!.textContent).toContain("from Aug 28");
    expect(all[4]!.textContent).toContain("part month");
    expect(all[5]!.textContent).toContain("not counted yet");
    expect(all[5]!.textContent).toContain("not compared");
    // Each cell's words end with a space, or "not counted yet" runs straight into the next cell's number.
    for (const row of all.slice(1)) {
      const cells = [...row.querySelectorAll("th, td")];
      for (const cell of cells.slice(0, -1)) expect(cell.textContent, cell.textContent ?? "").toMatch(/\s$/);
    }
    expect(document.body.textContent).toContain("thousands of decisions against a handful is a closed office");
    const notice = screen.getByRole("link", { name: "DOL's notice" });
    expect(notice.getAttribute("target")).toBe("_blank");
    expect(notice.getAttribute("href")).toMatch(/^https:\/\/www\.dol\.gov\//);
  });

  it("says where the counts come from, read off the records", () => {
    render(<DecisionPeriods views={views} table />);
    pick("Years");
    expect(document.body.textContent).toContain("through June 30, 2026, then our daily check of DOL's case status from August 28, 2026");
    expect(document.body.textContent).toContain("Our daily check's first day is August 28, 2026");
  });

  it("takes the year-earlier marks off and puts them back", () => {
    render(<DecisionPeriods views={views} />);
    const toggle = screen.getByRole("button", { name: "Mark the same days a year earlier" });
    // The key's line and the screen-reader table's column.
    expect(screen.getAllByText("The same days a year earlier")).toHaveLength(2);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryAllByText("The same days a year earlier")).toHaveLength(0);
  });

  it("opens on the month view from an old link to the month list", () => {
    window.location.hash = "#by-month";
    render(<DecisionPeriods views={views} table />);
    expect(screen.getByRole("heading", { level: 3, name: "Each month against a year earlier" })).toBeTruthy();
  });

  it("draws the chart alone in a tile", () => {
    window.location.hash = "#by-month";
    render(<DecisionPeriods views={views} bare />);
    expect(screen.queryByRole("group", { name: "Count decisions by" })).toBeNull();
    expect(screen.queryByText("A typical week")).toBeNull();
    expect(screen.getByRole("img", { name: /PERM decisions per day/ })).toBeTruthy();
  });
});
