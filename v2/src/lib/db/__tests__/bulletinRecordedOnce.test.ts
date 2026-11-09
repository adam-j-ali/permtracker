import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const one = vi.fn();
vi.mock("../client", () => ({ rows: vi.fn(async () => []), one, exec: vi.fn() }));

const { firstRecordingEach, predictBulletinRelease } = await import("../predictions");

/**
 * A bulletin's release day is one prediction: before Nov 9 2026 it was written again every morning until the range
 * opened, so the scorecard graded one bulletin as four.
 */
describe("a bulletin's release day counts once", () => {
  beforeEach(() => one.mockReset());

  it("keeps the first recording of each bulletin and leaves other programs alone", () => {
    // Arrange
    const rows = [
      { program: "bulletin", caseNumber: "bulletin:2026-11", recordedOn: "2026-10-03" },
      { program: "bulletin", caseNumber: "bulletin:2026-11", recordedOn: "2026-10-01" },
      { program: "bulletin", caseNumber: "bulletin:2026-11", recordedOn: "2026-10-02" },
      { program: "bulletin", caseNumber: "bulletin:2026-12", recordedOn: "2026-11-02" },
      { program: "perm", caseNumber: "G-100-26001-000001", recordedOn: "2026-10-01" },
    ];
    // Act
    const out = firstRecordingEach(rows, "bulletin");
    // Assert
    expect(out.map((r) => [r.caseNumber, r.recordedOn])).toEqual([
      ["bulletin:2026-11", "2026-10-01"],
      ["bulletin:2026-12", "2026-11-02"],
    ]);
  });

  it("writes nothing for a bulletin already recorded", async () => {
    // Arrange: the archive holds the November bulletin, and December's day was written yesterday.
    one.mockResolvedValueOnce({ m: "2026-11-01" }).mockResolvedValueOnce({ n: 1 });
    // Act
    const out = await predictBulletinRelease("2026-11-02");
    // Assert
    expect(out).toEqual([]);
    expect(one.mock.calls[1]![1]).toEqual(["bulletin:2026-12"]);
  });
});
