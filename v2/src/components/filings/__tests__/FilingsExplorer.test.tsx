import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * A chosen period never asks for more days than the route serves (RANGE_MAX_DAYS): From could go back to the start
 * of FY2020 from today, a range the route refuses, so the chart failed with no way to tell why.
 */
const asked = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@/hooks/usePublicQuery", () => ({
  usePublicQuery: (url: string) => {
    asked.urls.push(url);
    return { data: undefined, failed: false, previous: undefined, retry: vi.fn() };
  },
}));
vi.mock("@/hooks/useUrlSearchParams", () => ({
  useUrlSearchParams: () => new URLSearchParams("period=custom&from=2019-10-01&to=2026-11-01"),
  useUrlPatch: () => vi.fn(),
}));

const { FilingsExplorer } = await import("../FilingsExplorer");
const { RANGE_MAX_DAYS } = await import("@/lib/filingsByDay");
const { daysBetween } = await import("@/lib/time");

describe("FilingsExplorer's chosen period", () => {
  it("asks for no more days than the route serves, and its From box says how far back it goes", () => {
    // Arrange, Act
    render(<FilingsExplorer asOf="2026-11-01" windowFrom="2026-08-01" programs={{ perm: [], pwd: [], lca: [], seasonal: [] } as never} />);
    // Assert
    const url = asked.urls.find((u) => u.startsWith("/api/filings-by-day"))!;
    const q = new URLSearchParams(url.split("?")[1]);
    expect(daysBetween(q.get("from")!, q.get("to")!) + 1).toBeLessThanOrEqual(RANGE_MAX_DAYS);
    const fromBox = screen.getByLabelText("From");
    expect(daysBetween(fromBox.getAttribute("min")!, "2026-11-01") + 1).toBeLessThanOrEqual(RANGE_MAX_DAYS);
  });
});
