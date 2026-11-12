import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaseNotFound } from "../CaseNotFound";

/**
 * A number we can't find still decodes to a filing month, and the page shows that month's cases. The figures are
 * drawn: an icon on each, and the month's decided share as a bar whose sentence a screen reader gets in its place.
 */
describe("the not-found page's month figures", () => {
  it("draws the month's cases with an icon each and the decided share as a named bar", () => {
    // Arrange: a current-format number, and its month with 1,000 cases, 750 of them decided.
    render(
      <CaseNotFound
        caseNumber="G-100-26044-999999"
        parsed={{ caseNumber: "G-100-26044-999999", prefix: "G-100", filingDate: "2026-02-13", filingMonth: "2026-02", serial: "999999" }}
        cohort={{ month: "2026-02", total: 1000, pending: 250, decided: 750, decidedPct: 75 }}
        wall={null}
        neighbours={[]}
        publishedFront={null}
        publishedAsOf={null}
        mirrorSize={426112}
        dolMiss="none"
      />,
    );

    // Act: find the two cards by their labels.
    const filed = screen.getByText("Filed that month").closest("div")!;
    const waiting = screen.getByText("Still undecided").closest("div")!;

    // Assert: the counts, an icon in each label, and the bar's own sentence.
    expect(within(filed).getByText("1,000")).toBeInTheDocument();
    expect(within(waiting).getByText("250")).toBeInTheDocument();
    for (const card of [filed, waiting]) {
      expect(card.querySelector("p svg")).not.toBeNull();
    }
    expect(
      within(waiting).getByRole("img", { name: "75% of the cases filed in February 2026 are decided and 25% are still waiting" }),
    ).toBeInTheDocument();
    expect(within(waiting).getByText("75.0% of the month is decided")).toBeInTheDocument();
  });

  it("draws no bar for a month that holds nothing", () => {
    render(
      <CaseNotFound
        caseNumber="G-100-26044-999999"
        parsed={{ caseNumber: "G-100-26044-999999", prefix: "G-100", filingDate: "2026-02-13", filingMonth: "2026-02", serial: "999999" }}
        cohort={{ month: "2026-02", total: 0, pending: 0, decided: 0, decidedPct: null }}
        wall={null}
        neighbours={[]}
        publishedFront={null}
        publishedAsOf={null}
        mirrorSize={426112}
        dolMiss="none"
      />,
    );
    const waiting = screen.getByText("Still undecided").closest("div")!;
    expect(within(waiting).queryByRole("img")).toBeNull();
  });
});
