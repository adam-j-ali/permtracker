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

/** Each figure as [label, value, note], in the order shown. A figure's picture sits between its value and its note. */
function figures(container: HTMLElement): string[][] {
  const row = container.querySelector(".shadow-hard-sm");
  return [...(row?.children ?? [])].map((cell) => {
    const parts = [...cell.children].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());
    return [parts[0] ?? "", parts[1] ?? "", parts[parts.length - 1] ?? ""];
  });
}

/** The cells of the row, for a figure's picture and its card. */
const cells = (container: HTMLElement) => [...(container.querySelector(".shadow-hard-sm")?.children ?? [])] as HTMLElement[];

/** Filing months as the census gives them: January mostly decided, February under half. */
const months = [
  { month: "2025-12", total: 9000, decided: 8900, pending: 100, decidedPct: 98.9 },
  { month: "2026-01", total: 10000, decided: 7100, pending: 2900, decidedPct: 71 },
  { month: "2026-02", total: 9000, decided: 4320, pending: 4680, decidedPct: 48 },
  { month: "2026-03", total: 9500, decided: 300, pending: 9200, decidedPct: 3.2 },
];

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

  // The row read as three plain boxes of words. Each figure now says what it is at a glance (an icon), the month
  // DOL is deciding stands out on the dark card, and each month carries a bar of how much of it DOL has decided, in
  // the site's status colours: decided green, waiting yellow.
  describe("each figure carries a picture", () => {
    const props = { ...base, deciding: { month: "2026-02", asOf: "2026-11-12" }, months, toClear: 3000 };

    it("puts the month DOL is deciding on the dark card, alone", () => {
      const { container } = render(<CaseStatusEmpty {...props} />);
      const [lead, ...rest] = cells(container);
      expect(lead!.className).toContain("bg-[#141414]");
      for (const cell of rest) expect(cell.className).toContain("bg-card");
    });

    it("gives every figure an icon that a screen reader skips", () => {
      const { container } = render(<CaseStatusEmpty {...props} />);
      for (const cell of cells(container)) {
        const icon = cell.querySelector("p span[aria-hidden='true'] svg");
        expect(icon, cell.textContent ?? "").not.toBeNull();
      }
    });

    it("draws how much of each month DOL has decided, and says it in words", () => {
      const { container } = render(<CaseStatusEmpty {...props} />);
      const [deciding, oldest] = cells(container);
      const bar = deciding!.querySelector("[role='img']")!;
      expect(bar.getAttribute("aria-label")).toBe("48% of the cases filed in February 2026 are decided and 52% are still waiting");
      // Two parts, decided then waiting, sized by their counts.
      const parts = [...bar.children] as HTMLElement[];
      expect(parts.map((p) => p.className.includes("bg-data-good") ? "decided" : p.className.includes("bg-data-warn") ? "waiting" : "?")).toEqual(["decided", "waiting"]);
      expect(parts.map((p) => p.style.flexGrow)).toEqual(["4320", "4680"]);
      expect(deciding!.textContent).toContain("48% decided");
      expect(oldest!.querySelector("[role='img']")!.getAttribute("aria-label")).toBe(
        "71% of the cases filed in January 2026 are decided and 29% are still waiting",
      );
      expect(oldest!.textContent).toContain("71% decided");
    });

    it("splits the wall into the cases up next and the cases filed since", () => {
      const { container } = render(<CaseStatusEmpty {...props} />);
      const wall = cells(container)[2]!;
      expect(wall.querySelector("[role='img']")!.getAttribute("aria-label")).toBe(
        "3,000 of the 85,535 undecided cases were filed in January 2026 or earlier, and 82,535 since",
      );
      expect(wall.textContent).toContain("3,000 filed in January 2026 or earlier");
    });

    it("draws no bar for a month the census doesn't hold, and keeps the figure", () => {
      const { container } = render(<CaseStatusEmpty {...props} months={[]} toClear={null} />);
      const got = figures(container);
      expect(got.map((f) => f[0])).toEqual(["DOL is deciding now", "Oldest month still open", "Undecided cases"]);
      expect(container.querySelectorAll(".shadow-hard-sm [role='img']")).toHaveLength(0);
    });
  });

  it("fall back to the oldest open month alone when our check can't be read", () => {
    const { container } = render(<CaseStatusEmpty {...base} deciding={null} />);
    expect(figures(container).map((f) => f[0])).toEqual(["Oldest month still open", "Undecided cases"]);
  });
});
