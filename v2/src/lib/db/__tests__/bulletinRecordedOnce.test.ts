import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const one = vi.fn();
vi.mock("../client", () => ({ rows: vi.fn(async () => []), one, exec: vi.fn() }));

const { alarmRows, firstRecordingEach, predictBulletinRelease } = await import("../predictions");

/**
 * A bulletin's release day is one prediction: before Nov 9 2026 it was written again every morning until the range
 * opened, so the scorecard graded one bulletin as four.
 */
describe("a bulletin's release day counts once", () => {
  beforeEach(() => one.mockReset());

  it("keeps the first recording of each bulletin and leaves other programs alone", () => {
    // Arrange
    const rows = [
      { program: "bulletin", case_number: "bulletin:2026-11", recorded_on: "2026-10-03" },
      { program: "bulletin", case_number: "bulletin:2026-11", recorded_on: "2026-10-01" },
      { program: "bulletin", case_number: "bulletin:2026-11", recorded_on: "2026-10-02" },
      { program: "bulletin", case_number: "bulletin:2026-12", recorded_on: "2026-11-02" },
      { program: "perm", case_number: "G-100-26001-000001", recorded_on: "2026-10-01" },
    ];
    // Act
    const out = firstRecordingEach(rows, "bulletin");
    // Assert
    expect(out.map((r) => [r.case_number, r.recorded_on])).toEqual([
      ["bulletin:2026-11", "2026-10-01"],
      ["bulletin:2026-12", "2026-11-02"],
    ]);
  });

  it("gives the alarms one row per bulletin, and every row of the other programs", () => {
    // Arrange: December's release day written every morning from Oct 23 to Nov 9 before the record-once fix (18 rows).
    const stored = (program: string, caseNumber: string, recordedOn: string) => ({
      source: "ours", program, model: "m", recorded_on: recordedOn, predicted: "2026-11-13", band_early: null,
      band_late: null, decided_on: null, outcome: null, case_number: caseNumber,
    });
    const december = Array.from({ length: 18 }, (_, i) =>
      stored("bulletin", "bulletin:2026-12", `2026-10-${String(23 + i).padStart(2, "0")}`));
    const perm = [stored("perm", "G-100-26001-000001", "2026-11-01"), stored("perm", "G-100-26001-000002", "2026-11-01")];
    // Act
    const out = alarmRows([...december, ...perm]);
    // Assert
    expect(out.filter((r) => r.program === "bulletin")).toHaveLength(1);
    expect(out.find((r) => r.program === "bulletin")?.recordedOn).toBe("2026-10-23");
    expect(out.filter((r) => r.program === "perm")).toHaveLength(2);
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
