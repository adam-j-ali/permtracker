// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { StatusMove } from "@/lib/board";

/**
 * The /today status tiles. The board's moves name only the statuses that saw a transition, so a status missing from a
 * list that was read didn't move and reads "same"; only a board that couldn't be read gives no reading. On a quiet
 * day every Denied and Withdrawn tile had said "no reading".
 */
type TileRow = { status: string; day: StatusMove | null; week: StatusMove | null };
const tiles = vi.hoisted(() => ({ calls: [] as { rows: TileRow[]; closed?: boolean }[] }));
const board = vi.hoisted(() => ({ perm: null as unknown }));

vi.mock("@/components/board/BoardParts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/board/BoardParts")>();
  const Stub = () => null;
  return {
    statusMoveOf: real.statusMoveOf,
    moved: real.moved,
    StatusTiles: (props: { rows: TileRow[]; closed?: boolean }) => {
      tiles.calls.push(props);
      return null;
    },
    BulletinGrid: Stub,
    DecidedBar: Stub,
    FlowPair: Stub,
    Station: Stub,
    Track: Stub,
    WaitBar: Stub,
  };
});
vi.mock("@/components/board/BulletinStation", () => ({ BulletinStation: () => null }));
vi.mock("@/components/board/StagePicker", () => ({ StagePicker: () => null }));
vi.mock("@/components/pulse/DecisionsOverTime", () => ({ DecisionsOverTime: () => null }));
vi.mock("@/lib/db/board", () => ({ getPermBoard: async () => board.perm, getPwdBoard: async () => null }));
vi.mock("@/lib/db/bulletin", () => ({ getBulletinBoard: async () => null }));
vi.mock("@/lib/db/liveCensus", () => ({ getLiveCensus: async () => null }));
vi.mock("@/lib/db/publicData", () => ({ getVisaBulletins: async () => [] }));
vi.mock("@/lib/db/pulse", () => ({ getObservedDays: async () => [] }));
vi.mock("@/lib/db/sweepCoverage", () => ({ getSweepCoverage: async () => null }));
vi.mock("@/lib/db/uscisQuarterly", () => ({ getUscisFormHistory: async () => [], getUscisFormMedian: async () => null }));
vi.mock("@/lib/softRead", () => ({ softFail: () => () => null }));

const { default: TodayPage } = await import("../page");

const readBoard = {
  day: "2026-11-06",
  span: null,
  flow: { filed: 100, decided: 90, change: 10, trend: "level", from: "2026-10-08", to: "2026-11-06" },
  // A quiet day: only analyst review moved, so Denied and Withdrawn aren't in the lists at all.
  movesDay: [{ status: "ANALYST REVIEW", in: 40, out: 25, net: 15 }],
  movesWeek: [{ status: "ANALYST REVIEW", in: 300, out: 280, net: 20 }],
  weekBefore: null,
  monthBefore: null,
};

async function decidedTiles(): Promise<TileRow[]> {
  tiles.calls.length = 0;
  render(await TodayPage());
  return tiles.calls.find((c) => c.closed)?.rows ?? [];
}

beforeEach(() => {
  board.perm = null;
});

describe("the /today status tiles", () => {
  it("give a quiet status a zero move after a good read, so its tile says \"same\"", async () => {
    // Arrange
    board.perm = readBoard;
    // Act
    const denied = (await decidedTiles()).find((r) => r.status === "DENIED")!;
    // Assert
    expect(denied.day).toEqual({ status: "DENIED", in: 0, out: 0, net: 0 });
    expect(denied.week).toEqual({ status: "DENIED", in: 0, out: 0, net: 0 });
  });

  it("give no reading only when the board couldn't be read", async () => {
    // Arrange: the board read failed
    board.perm = null;
    // Act
    tiles.calls.length = 0;
    render(await TodayPage());
    // Assert: with no board there are no status tiles to mislabel at all
    const all = tiles.calls.flatMap((c) => c.rows);
    for (const r of all) {
      expect(r.day).toBeNull();
      expect(r.week).toBeNull();
    }
  });

  it("list a waiting status only when it has cases or moved, not for a zero move", async () => {
    // Arrange
    board.perm = readBoard;
    // Act
    tiles.calls.length = 0;
    render(await TodayPage());
    const waiting = tiles.calls.find((c) => !c.closed)?.rows ?? [];
    // Assert: the census couldn't be read, so only the status that moved is listed
    expect(waiting.map((r) => r.status)).toEqual(["ANALYST REVIEW"]);
  });
});
