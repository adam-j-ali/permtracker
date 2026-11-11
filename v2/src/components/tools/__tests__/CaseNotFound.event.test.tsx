import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics", () => ({ analytics: { capture } }));

import { CaseNotFound } from "../CaseNotFound";

const base = {
  caseNumber: "G-100-26125-868956",
  parsed: null,
  cohort: null,
  wall: null,
  neighbours: [],
  publishedFront: null,
  publishedAsOf: null,
  mirrorSize: 426112,
};

beforeEach(() => capture.mockClear());

describe("a lookup that ends with no record is counted", () => {
  it("sends one event saying DOL holds none either", () => {
    const { rerender } = render(<CaseNotFound {...base} dolMiss="none" />);
    rerender(<CaseNotFound {...base} dolMiss="none" />);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("case_not_found", { why: "none", format: "unreadable" });
  });

  it("tells a check that couldn't be made apart from a real miss", () => {
    render(<CaseNotFound {...base} dolMiss="unavailable" />);

    expect(capture).toHaveBeenCalledWith("case_not_found", { why: "gap", format: "unreadable" });
  });

  it("says which form the number was in", () => {
    render(<CaseNotFound {...base} isLegacy dolMiss="none" />);

    expect(capture).toHaveBeenCalledWith("case_not_found", { why: "none", format: "legacy" });
  });

  it("never sends the case number", () => {
    render(<CaseNotFound {...base} dolMiss="none" />);

    expect(JSON.stringify(capture.mock.calls)).not.toContain("868956");
  });
});
