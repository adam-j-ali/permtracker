import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { BlockStatusCard } from "../BlockStatusCard";
import { blockStatusMix } from "@/lib/uscisSample";

const MIX = blockStatusMix([
  { grp: "approved", status: "", n: 270 },
  { grp: "denied", status: "", n: 11 },
  { grp: "rfe", status: "", n: 4 },
  { grp: "closed", status: "", n: 6 },
  { grp: "waiting", status: "USCIS Is currently Processing the Case", n: 329 },
  { grp: "waiting", status: "Case Was Received and A Receipt Notice Was Sent", n: 125 },
  { grp: "waiting", status: "", n: 55 },
]);

describe("BlockStatusCard", () => {
  it("leads with the block's cases, then each group with its count and share", () => {
    render(<BlockStatusCard block="IOE09377" asOf="2026-11-26" mix={MIX} every />);
    expect(screen.getByText("800")).toBeTruthy();
    const legend = screen.getByRole("list", { name: "The cases in IOE09377 by status" });
    const rows = within(legend).getAllByRole("listitem").map((li) => li.textContent?.replace(/\s+/g, " ").trim());
    expect(rows).toEqual([
      "Approved 270 34%",
      "Denied 11 1.4%",
      "Evidence request 4 0.5%",
      "Other outcomes 6 0.8%",
      "Waiting 509 64%",
    ]);
  });

  it("names the waiting steps, largest first, the rarer ones last", () => {
    render(<BlockStatusCard block="IOE09377" asOf="2026-11-26" mix={MIX} every />);
    expect(screen.getByText("Where the 509 waiting cases are")).toBeTruthy();
    expect(screen.getByText("Being processed")).toBeTruthy();
    expect(screen.getByText("Received")).toBeTruthy();
    expect(screen.getByText("Other waiting steps")).toBeTruthy();
  });

  it("says every number was checked only when it was, and carries the page's address for a screenshot", () => {
    const { container, rerender } = render(<BlockStatusCard block="IOE09377" asOf="2026-11-26" mix={MIX} every />);
    expect(container.textContent).toContain("Every number checked, November 26, 2026");
    expect(container.textContent).toContain("permtracker.app/uscis-receipt-blocks/IOE09377");
    rerender(<BlockStatusCard block="IOE09360" asOf="2026-11-26" mix={MIX} every={false} />);
    expect(container.textContent).toContain("The cases checked so far, November 26, 2026");
    expect(container.textContent).not.toContain("Every number checked");
  });

  it("gives the bar one name that reads every group, so it never relies on colour alone", () => {
    render(<BlockStatusCard block="IOE09377" asOf="2026-11-26" mix={MIX} every />);
    const bar = screen.getByRole("img", { name: /The cases in IOE09377 by status/ });
    expect(bar.getAttribute("aria-label")).toBe(
      "The cases in IOE09377 by status: Approved 34%, Denied 1.4%, Evidence request 0.5%, Other outcomes 0.8%, Waiting 64%.",
    );
    // Each segment carries its exact figures for the tooltip; a group of several parts names them.
    const tips = [...bar.querySelectorAll("[data-tip]")].map((el) => el.getAttribute("data-tip"));
    expect(tips[0]).toBe("Approved: 270 cases, 34%");
    expect(tips[3]).toBe("Other outcomes: 6 cases, 0.8%");
  });
});
