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

  it("says a form's numbers hold an I-765 or a G-28 case, the article read the way the form's letter is said", () => {
    const { container, rerender } = render(<BlockStatusCard block="IOE09373" asOf="2026-11-26" mix={MIX} every form="I-765" />);
    expect(container.textContent).toContain("of them hold an I-765 case");
    rerender(<BlockStatusCard block="IOE09373" asOf="2026-11-26" mix={MIX} every form="G-28" />);
    expect(container.textContent).toContain("of them hold a G-28 case");
  });

  it("says when the block's cases were received, and what the numbers without a case answer", () => {
    const { container, rerender } = render(
      <BlockStatusCard block="IOE09363" asOf="2026-11-26" mix={MIX} every received={{ from: "2026-04-03", to: "2026-04-10" }} blockCases={800} />,
    );
    const text = container.textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("Received about April 3 to 10, 2026");
    expect(text).toContain("800 of them hold a case. For nearly all of the other 99,200, USCIS's page answers \"Invalid number\", and it doesn't say why.");
    rerender(<BlockStatusCard block="IOE09363" asOf="2026-11-26" mix={MIX} every form="I-765" blockCases={80000} />);
    expect(container.textContent?.replace(/\s+/g, " ")).toContain("800 of them hold an I-765 case and 80,000 hold a case of any form. For nearly all of the other 20,000");
    rerender(<BlockStatusCard block="IOE09363" asOf="2026-11-26" mix={MIX} every={false} received={{ from: "2026-04-03", to: "2026-04-10" }} blockCases={800} />);
    expect(container.textContent).not.toContain("Invalid number");
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
