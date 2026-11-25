import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BesideTheCase } from "../TimelineBoard";
import type { SideFigure } from "@/lib/reportedSummary";

/** A figure beside the case as the summary stores it (scripts/lib_reported_summary.py SIDE_STEPS). */
const f = (id: string, label: string, median: number | null): SideFigure => ({
  id, label, group: "side", verified: false, n: median === null ? 2 : 40, windowDays: median === null ? null : 183,
  median, p25: median && median - 10, p75: median && median + 10, before: null, allTime: 40, months: [],
});

describe("BesideTheCase", () => {
  it("draws the summary's RFE and H-4 figures, and lists the ones with too few cases", () => {
    const { container } = render(
      <BesideTheCase
        side={[f("rfe-answer", "RFE issued to answered", 45), f("h4-i539", "H-4 extension, filed to approved", 120), f("h4-ead-alone", "H-4 work permit filed on its own, filed to approved", null)]}
      />,
    );
    expect(screen.getByRole("heading", { name: /RFEs and a spouse's H-4/ })).toBeTruthy();
    // Labels pass through KeepWhole, which wraps a program name in its own span: read the text, not one node.
    const text = container.textContent ?? "";
    expect(text).toContain("RFE issued to answered");
    expect(text).toContain("Median 45 days");
    expect(text).toContain("H-4 extension, filed to approved");
    expect(text).toContain("Too few cases yet for a figure:");
    expect(screen.getAllByRole("listitem").some((li) => li.textContent?.trim() === "H-4 work permit filed on its own, filed to approved")).toBe(true);
  });

  it("draws nothing until one of them has a figure, or when the summary is older than the side figures", () => {
    const unmeasured = render(<BesideTheCase side={[f("rfe-answer", "RFE issued to answered", null), f("h4-i539", "H-4 extension, filed to approved", null)]} />);
    expect(unmeasured.container.textContent).toBe("");
    expect(render(<BesideTheCase side={undefined} />).container.textContent).toBe("");
  });
});
