import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WhoIsWaiting } from "../TimelineBoard";
import { textContent } from "../../../../test-utils/text-content";

const byStage = [
  { id: "pwd", label: "Wage request or recruitment", count: 310 },
  { id: "perm", label: "PERM pending", count: 1840 },
  { id: "i485", label: "I-485 pending", count: 96 },
];
const lines = [{ category: "EB-2", country: "India", counts: [0, 0, 41], total: 41 }];

describe("WhoIsWaiting", () => {
  it("drops a step nobody is at, from the bars and the table", () => {
    const office = [{ id: "perm", label: "PERM pending", count: 0 }, { id: "i485", label: "I-485 pending", count: 40 }];
    render(<WhoIsWaiting waiting={{ byStage: office, lines: [{ category: "EB-2", country: "India", counts: [0, 12], total: 12 }], unlisted: 28, unlistedCounts: [0, 28] }} total={40} noun={["person", "people"]} />);
    expect(screen.queryByText("PERM pending")).not.toBeInTheDocument();
    expect(screen.getAllByText(textContent("I-485 pending")).length).toBeGreaterThan(0);
  });

  it("leads with everyone at each step and ends with the people no line shows, so no column reads all zeros", () => {
    render(<WhoIsWaiting waiting={{ byStage, lines, unlisted: 2205, unlistedCounts: [310, 1840, 55] }} total={2246} noun={["person", "people"]} />);
    const table = screen.getByRole("table");
    const everyone = within(table).getByRole("row", { name: /Everyone heard from/ });
    expect(everyone).toHaveTextContent("1,840");
    const rest = within(table).getByRole("row", { name: /No category or country given/ });
    expect(rest).toHaveTextContent("1,840");
    expect(rest).toHaveTextContent("55");
    expect(screen.queryByText(/more people sit on a category and country/)).not.toBeInTheDocument();
  });

  it("keeps the shared board's line in words, which has no counts by step", () => {
    render(<WhoIsWaiting waiting={{ byStage, lines, unlisted: 7 }} total={60} />);
    expect(screen.queryByRole("row", { name: /Everyone heard from/ })).not.toBeInTheDocument();
    expect(screen.getByText(/7 more timelines sit on a category and country/)).toBeInTheDocument();
  });

  it("says how many no line shows when no line has five people", () => {
    render(<WhoIsWaiting waiting={{ byStage, lines: [], unlisted: 2246, unlistedCounts: [310, 1840, 96] }} total={2246} noun={["person", "people"]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/2,246 more people sit on a category and country/)).toBeInTheDocument();
  });
});
