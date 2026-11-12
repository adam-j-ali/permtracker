// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { WAIT_COLUMNS, type WaitCell } from "@/lib/visaWaits";

import { VisaWaitTable, type PostWaits } from "../VisaWaitTable";

const WORK = WAIT_COLUMNS[0].key;
const cell = (post: string, days: number | null): WaitCell =>
  ({
    post,
    visaClass: WAIT_COLUMNS[0].visaClass,
    measure: "next",
    waitText: days === null ? "N/A" : `${days} days`,
    kind: days === null ? "na" : "value",
    amount: days,
    unit: days === null ? null : "day",
    bound: null,
    days,
  }) as WaitCell;

const posts: PostWaits[] = [
  { post: "Abu Dhabi", cells: { [WORK]: cell("Abu Dhabi", 20) } },
  { post: "Mumbai", cells: { [WORK]: cell("Mumbai", 90) } },
  { post: "Reykjavik", cells: { [WORK]: cell("Reykjavik", null) } },
  { post: "Windhoek", cells: {} },
];

describe("VisaWaitTable", () => {
  it("opens at the longest work-visa wait, with posts that have no figure last", () => {
    render(<VisaWaitTable posts={posts} />);
    const order = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(order[0]).toContain("Mumbai");
    expect(order[1]).toContain("Abu Dhabi");
    expect(order.slice(2).join(" ")).toContain("Reykjavik");
    expect(order.slice(2).join(" ")).toContain("Windhoek");
  });

  it("says a consulate has no figure, or isn't in State's table, in words", () => {
    render(<VisaWaitTable posts={posts} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("90 days")).toBeDefined();
    expect(within(table).getAllByText("No figure").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Not listed").length).toBeGreaterThan(0);
  });

  it("finds one consulate by typing its city", () => {
    render(<VisaWaitTable posts={posts} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "mumb" } });
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Mumbai");
  });

  it("keeps every visa's column on a phone: none is drawn for wide screens only", () => {
    // For one release the visitor (B1/B2) and crew columns were hidden under 640px, and only the download had them.
    const { container } = render(<VisaWaitTable posts={posts} />);
    const heads = [...container.querySelectorAll("thead th")];
    expect(heads.map((th) => th.textContent?.replace(/\s+/g, " ").trim())).toEqual(
      expect.arrayContaining(["Consulate", "H, L, O, P, Q", "F, M, J", "B1/B2 next", "B1/B2 average", "C, D"]),
    );
    for (const cell of container.querySelectorAll("thead th, tbody td")) {
      expect(cell.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    }
  });
});
