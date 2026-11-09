import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { StatusMove } from "@/lib/board";

import { StatusTiles, statusMoveOf } from "../BoardParts";

/**
 * A status tile's change for a window. A list of moves that was read but doesn't name a status means that status
 * didn't move ("same"); only a failed read has no reading. The moves list names only statuses that saw a transition,
 * so on a quiet day most statuses are missing from it.
 */
const read: StatusMove[] = [{ status: "ANALYST REVIEW", in: 40, out: 25, net: 15 }];

describe("statusMoveOf", () => {
  it("gives a status missing from a list that was read a zero move", () => {
    expect(statusMoveOf(read, "DENIED")).toEqual({ status: "DENIED", in: 0, out: 0, net: 0 });
  });

  it("gives the status's own move when the list names it", () => {
    expect(statusMoveOf(read, "ANALYST REVIEW")).toEqual(read[0]);
  });

  it("gives no move at all when the list couldn't be read", () => {
    expect(statusMoveOf(undefined, "DENIED")).toBeNull();
  });
});

describe("StatusTiles", () => {
  it("says \"same\" for a status that didn't move in a list that was read", () => {
    // Arrange, Act
    render(
      <StatusTiles
        dayLabel="Yesterday"
        closed
        rows={[{ status: "DENIED", now: 300, day: statusMoveOf(read, "DENIED"), week: statusMoveOf(read, "DENIED") }]}
      />,
    );
    // Assert
    expect(screen.getAllByText("same")).toHaveLength(2);
    expect(screen.queryByText("no reading")).toBeNull();
  });

  it("says there's no reading only where the read failed", () => {
    // Arrange, Act
    render(
      <StatusTiles
        dayLabel="Yesterday"
        rows={[{ status: "ANALYST REVIEW", now: 1200, day: statusMoveOf(undefined, "ANALYST REVIEW"), week: statusMoveOf(read, "ANALYST REVIEW") }]}
      />,
    );
    // Assert: the day failed, the week was read and moved
    expect(screen.getByText("no reading")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });
});
