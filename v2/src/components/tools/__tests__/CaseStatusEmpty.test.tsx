import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaseStatusEmpty } from "../CaseNotFound";

/**
 * The figures under the case box, before a number is typed. The page lost the month DOL is deciding on
 * Oct 31 2026: it showed that month only while DOL's own table printed one, DOL stopped printing it, and the
 * figure dropped out with nothing said. The month comes from our own daily check now, and it leads.
 */

const base = {
  front: "2026-01",
  wallTotal: 85535,
  publishedFront: null,
  publishedAsOf: null,
  mirrorSize: 426112,
};

/** Each figure as [label, value, note], in the order shown. */
function figures(container: HTMLElement): string[][] {
  const row = container.querySelector(".shadow-hard-sm");
  return [...(row?.children ?? [])].map((cell) => [...cell.children].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()));
}

describe("the figures under the case box", () => {
  it("lead with the month DOL is deciding now, by our own check, then the oldest month still open", () => {
    const { container } = render(<CaseStatusEmpty {...base} deciding={{ month: "2026-02", asOf: "2026-11-12" }} />);
    const got = figures(container);
    expect(got.map((f) => f[0])).toEqual(["DOL is deciding now", "Oldest month still open", "Undecided cases"]);
    expect(got[0]![1]).toBe("February 2026");
    expect(got[0]![2]).toBe("cases filed that month, by our check of DOL's case status on Nov 12");
    expect(got[1]![1]).toBe("January 2026");
    expect(got[2]![1]).toBe("85,535");
  });

  it("show the month once when the oldest open month is the one DOL is deciding", () => {
    const { container } = render(<CaseStatusEmpty {...base} front="2026-02" deciding={{ month: "2026-02", asOf: "2026-11-12" }} />);
    expect(figures(container).map((f) => f[0])).toEqual(["DOL is deciding now", "Undecided cases"]);
  });

  it("keep DOL's own month beside ours while DOL's table prints one", () => {
    const { container } = render(
      <CaseStatusEmpty
        {...base}
        deciding={{ month: "2026-02", asOf: "2026-11-12" }}
        publishedFront="2025-12"
        publishedAsOf="2026-10-21"
      />,
    );
    const got = figures(container);
    expect(got.map((f) => f[0])).toEqual(["DOL is deciding now", "Oldest month still open", "Undecided cases", "DOL's own table"]);
    expect(got[3]![1]).toBe("December 2025");
  });

  it("fall back to the oldest open month alone when our check can't be read", () => {
    const { container } = render(<CaseStatusEmpty {...base} deciding={null} />);
    expect(figures(container).map((f) => f[0])).toEqual(["Oldest month still open", "Undecided cases"]);
  });
});
