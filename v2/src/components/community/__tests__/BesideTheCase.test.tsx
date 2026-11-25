import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BesideTheCase } from "../TimelineBoard";
import type { MetricResult } from "@/lib/communityTimeline";

const m = (id: string, label: string, median: number | null): MetricResult =>
  ({ id, label, verified: false, n: median === null ? 2 : 40, median, p25: median && median - 10, p75: median && median + 10 }) as MetricResult;

describe("BesideTheCase", () => {
  it("draws the RFE and H-4 medians the merged steps don't carry, and none of the steps they do", () => {
    const { container } = render(
      <BesideTheCase
        metrics={[m("i485-bio", "I-485 filed to biometrics", 30), m("rfe-answer", "RFE issued to answered", 45), m("h4-i539", "H-4 extension, filed to approved", 120)]}
      />,
    );
    expect(screen.getByRole("heading", { name: /RFEs and a spouse's H-4/ })).toBeTruthy();
    // Labels pass through keepWhole, which wraps a program name in its own span: read the text, not one node.
    const text = container.textContent ?? "";
    expect(text).toContain("RFE issued to answered");
    expect(text).toContain("H-4 extension, filed to approved");
    expect(text).not.toContain("I-485 filed to biometrics");
  });

  it("draws nothing until one of them has a median: five empty rows would only say so five times", () => {
    const none = render(<BesideTheCase metrics={[m("i485-bio", "I-485 filed to biometrics", 30)]} />);
    expect(none.container.textContent).toBe("");
    const unmeasured = render(<BesideTheCase metrics={[m("rfe-answer", "RFE issued to answered", null), m("h4-i539", "H-4 extension, filed to approved", null)]} />);
    expect(unmeasured.container.textContent).toBe("");
  });
});
