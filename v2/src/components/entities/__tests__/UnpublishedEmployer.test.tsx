import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

/** The live-only employer page keeps a word between each status's count and its share, for anything reading its text. */
vi.mock("@/components/data/DataProvenance", () => ({ DataProvenance: () => null }));
vi.mock("@/components/entities/FilingRows", () => ({ FilingRows: () => null }));

const { UnpublishedEmployer } = await import("../UnpublishedEmployer");

describe("UnpublishedEmployer's status counts", () => {
  it("keeps a word between a status's count and its share", () => {
    // Arrange, Act
    const { container } = render(
      <UnpublishedEmployer
        record={{
          slug: "northwind",
          name: "Northwind Traders",
          otherNames: [],
          cases: 1_210,
          pending: 1_210,
          firstFiling: "2025-01-02",
          lastFiling: "2026-10-01",
          stages: [
            { status: "ANALYST REVIEW", n: 1_200, isFinal: false },
            { status: "RFI ISSUED", n: 10, isFinal: false },
          ],
        } as never}
        cases={[]}
        asOf="2026-11-01"
      />,
    );
    // Assert: "1,200 99.2%", never "1,20099.2%"
    const counts = [...container.querySelectorAll("dd")].map((d) => d.textContent ?? "").filter((t) => /%/.test(t));
    expect(counts.length).toBeGreaterThan(0);
    for (const t of counts) expect(t).toMatch(/\d [<>]?\d+(\.\d)?%/);
  });
});
