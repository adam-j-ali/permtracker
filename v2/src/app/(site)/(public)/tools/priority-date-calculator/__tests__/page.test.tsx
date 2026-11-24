import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * What the priority date page hands the browser. The board draws each queue's newest cutoff, pace and backward steps,
 * never its month-by-month history, and that history was 0.76 MB of the page's 1.61 MB (Nov 23 2026): every cell's
 * every bulletin since 2005, carried to a component that never reads it. The page is held under 1.5 MB of HTML
 * (scripts/audit_page_markup.py).
 */

const sent = vi.hoisted(() => ({ board: null as unknown }));

const BULLETINS = Array.from({ length: 24 }, (_, i) => {
  const month = `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  const cutoff = `01${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][i % 12]}${String(13 + Math.floor(i / 12))}`;
  return {
    bulletinMonth: month,
    archivedAt: "2026-11-03T12:47:36Z",
    sourceUrl: "travel.state.gov",
    finalAction: { EB2: { india: cutoff, china: cutoff }, EB3: { india: cutoff } },
    datesForFiling: { EB2: { india: cutoff } },
  };
});

vi.mock("@/lib/db/publicData", () => ({
  getVisaBulletins: async () => BULLETINS,
  getVisaBulletinSeries: async () => BULLETINS,
}));
vi.mock("@/lib/uscisChartsFetch", () => ({ getUscisCharts: async () => null }));
vi.mock("@/components/data/DataProvenance", () => ({ DataProvenance: () => null }));
vi.mock("@/components/tools/BulletinAlertForm", () => ({ BulletinAlertForm: () => null }));
vi.mock("@/components/tools/PriorityDateEstimator", () => ({ PriorityDateEstimator: () => null }));
vi.mock("@/components/bulletin/BulletinBoard", () => ({
  BulletinBoard: (props: { board: unknown }) => {
    sent.board = props.board;
    return null;
  },
}));

const { default: PriorityDateCalculatorPage } = await import("../page");

describe("/tools/priority-date-calculator", () => {
  it("sends the board its figures without any cell's month-by-month history", async () => {
    // Act
    renderToStaticMarkup(await PriorityDateCalculatorPage());
    // Assert
    const board = sent.board as { finalAction: object[]; datesForFiling: object[] } | null;
    expect(board).not.toBeNull();
    // Control: the fixture really has cells, so an empty board can't pass for a slim one.
    expect(board!.finalAction.length).toBeGreaterThan(2);
    for (const cell of [...board!.finalAction, ...board!.datesForFiling]) {
      expect(Object.keys(cell)).not.toContain("states");
      expect(Object.keys(cell)).toContain("pace");
    }
  });
});
