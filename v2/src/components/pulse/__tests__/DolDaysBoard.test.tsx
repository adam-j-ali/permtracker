import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DolDaysBoard } from "../DolDaysBoard";
import type { DolDay } from "@/lib/dolDays";

/** Fourteen complete days ending Wed Nov 11, 2026 (Veterans Day), newest first. */
const days: DolDay[] = [
  { date: "2026-11-11", perm: 165, wage: 53 },
  { date: "2026-11-10", perm: 680, wage: 852 },
  { date: "2026-11-09", perm: 563, wage: 722 },
  { date: "2026-11-08", perm: 0, wage: 0 },
  { date: "2026-11-07", perm: 45, wage: 37 },
  { date: "2026-11-06", perm: 559, wage: 500 },
  { date: "2026-11-05", perm: 817, wage: 808 },
  { date: "2026-11-04", perm: 700, wage: 800 },
  { date: "2026-11-03", perm: 700, wage: 800 },
  { date: "2026-11-02", perm: 700, wage: 800 },
  { date: "2026-11-01", perm: 0, wage: 0 },
  { date: "2026-10-31", perm: 0, wage: 0 },
  { date: "2026-10-30", perm: 700, wage: 800 },
  { date: "2026-10-29", perm: 700, wage: 800 },
];

describe("PERM decisions and wage determinations, side by side", () => {
  it("gives each week its figure, with the change from the week before and the holiday named", () => {
    render(<DolDaysBoard days={days} />);
    expect(screen.getByRole("heading", { level: 2, name: "PERM decisions and wage determinations, side by side" })).toBeTruthy();
    const text = document.body.textContent ?? "";
    // 165 + 680 + 563 + 0 + 45 + 559 + 817 = 2,829 against 3,500 the week before.
    expect(text).toContain("2,829");
    expect(text).toContain("19% fewer than the week before (3,500), with Veterans Day in it");
    // 53 + 852 + 722 + 0 + 37 + 500 + 808 = 2,972 against 4,000.
    expect(text).toContain("2,972");
    expect(text).toContain("26% fewer than the week before (4,000), with Veterans Day in it");
    expect(text).toContain("Certified, denied or withdrawn, through Nov 11.");
  });

  it("draws a row a day, newest first, and names the day DOL was closed", () => {
    render(<DolDaysBoard days={days} />);
    const table = screen.getByRole("table", { name: /PERM decisions and wage determinations DOL issued each day/ });
    const rows = within(table).getAllByRole("row");
    // The header and fourteen days: every row stays in the page, and a style rule shows one page of them.
    expect(rows).toHaveLength(15);
    expect(rows[1]!.textContent).toContain("Wed, Nov 11");
    expect(rows[1]!.textContent).toContain("Veterans Day, DOL closed");
    expect(rows[1]!.textContent).toContain("165");
    expect(rows[1]!.textContent).toContain("53");
    expect(rows[2]!.textContent).toContain("Tue, Nov 10");
    // A bar under each count that isn't zero; none for a zero.
    expect(rows[2]!.querySelectorAll("[data-bar]")).toHaveLength(2);
    expect(rows[4]!.querySelectorAll("[data-bar]")).toHaveLength(0);
  });

  it("says not counted, never zero, for a day one record hasn't reached, and gives that week no figure", () => {
    const late: DolDay[] = [{ date: "2026-11-11", perm: null, wage: 53 }, ...days.slice(1)];
    render(<DolDaysBoard days={late} />);
    const table = screen.getByRole("table", { name: /each day/ });
    const first = within(table).getAllByRole("row")[1]!;
    expect(first.textContent).toContain("not counted");
    expect(document.body.textContent).toContain("Not counted yet");
    expect(document.body.textContent).toContain("Our check hasn't reached one of these seven days yet.");
    // The wage side is whole, so it keeps its figure.
    expect(document.body.textContent).toContain("2,972");
  });

  it("draws the two figures only, with the way on, where a page asks for that", () => {
    render(<DolDaysBoard days={days} rows={false} level={3} headingId="home-dol-days" more={{ href: "/perm-decision-activity#dol-days", label: "Day by day" }} />);
    expect(screen.getByRole("heading", { level: 3, name: /side by side/ })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("link", { name: "Day by day" }).getAttribute("href")).toBe("/perm-decision-activity#dol-days");
  });

  it("draws nothing with no day to show", () => {
    const { container } = render(<DolDaysBoard days={[]} />);
    expect(container.textContent).toBe("");
  });
});
