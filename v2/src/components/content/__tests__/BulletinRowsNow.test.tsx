import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { cutoffLabel } from "@/lib/bulletinNext";

/**
 * An article's bulletin rows come from the archive the bulletin pages read, so it never types a month's cutoffs the
 * next bulletin replaces; when the archive can't be read it says so and links the bulletin page, never an empty table.
 */
const board = vi.hoisted(() => ({ value: null as unknown, fail: false }));
vi.mock("@/lib/db/bulletin", () => ({
  getBulletinBoard: vi.fn(async () => {
    if (board.fail) throw new Error("db down");
    return board.value;
  }),
}));

const { BulletinRowsNow } = await import("../BulletinRowsNow");

const cell = (category: string, country: string, latest: unknown) => ({ category, country, latest, latestMonth: "2026-11" });
const NOVEMBER = {
  lastMonth: "2026-11",
  finalAction: [
    cell("EB3", "worldwide", { kind: "date", iso: "2024-09-01" }),
    cell("EB3", "india", { kind: "date", iso: "2014-01-01" }),
    cell("EW3", "worldwide", { kind: "date", iso: "2022-04-01" }),
    cell("EW3", "china", { kind: "unavailable" }),
  ],
  datesForFiling: [],
};

async function show(props: Parameters<typeof BulletinRowsNow>[0]) {
  render((await BulletinRowsNow(props)) as ReactElement);
}

describe("BulletinRowsNow", () => {
  it("prints the newest bulletin's rows, named, with its month", async () => {
    // Arrange
    board.fail = false;
    board.value = NOVEMBER;
    // Act
    await show({ categories: ["EB3", "EW3"] });
    // Assert
    const table = screen.getByRole("table");
    expect(within(table).getByText(/November 2026 visa bulletin/)).toBeInTheDocument();
    const other = within(table).getByRole("row", { name: /EB-3 other workers/ });
    expect(within(other).getByText(cutoffLabel({ kind: "date", iso: "2022-04-01" }))).toBeInTheDocument();
    expect(within(other).getByText("Unavailable")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  it("says the dates can't be shown, and links the bulletin page, when the archive can't be read", async () => {
    // Arrange
    board.fail = true;
    // Act
    await show({ categories: ["EB3", "EW3"] });
    // Assert
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("link", { name: "The visa bulletin page" })).toHaveAttribute("href", "/visa-bulletin");
  });

  it("never draws an empty table for a category the archive doesn't hold", async () => {
    // Arrange
    board.fail = false;
    board.value = NOVEMBER;
    // Act
    await show({ categories: ["EB9"] });
    // Assert
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/can't be shown here for the moment/)).toBeInTheDocument();
  });
});
