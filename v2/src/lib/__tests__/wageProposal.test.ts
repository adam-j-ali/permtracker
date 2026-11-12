import { describe, expect, it } from "vitest";

import { LEVEL_PERCENTILES, proposedFloors, type LevelWage } from "@/lib/wageProposal";

// Software developers in the San Jose area, DOL's July 2026 to June 2027 series (read Nov 11 2026).
const SAN_JOSE: LevelWage[] = [
  { level: "I", hourly: 73.46, yearly: 152_797 },
  { level: "II", hourly: 89.94, yearly: 187_075 },
  { level: "III", hourly: 106.43, yearly: 221_374 },
  { level: "IV", hourly: 122.91, yearly: 255_653 },
];

describe("the proposed wage levels, read against today's", () => {
  it("puts the new Level I about where today's Level II is", () => {
    const floors = proposedFloors(SAN_JOSE)!;

    expect(floors[0]).toMatchObject({ level: "I", proposed: { kind: "about", yearly: 187_075, hourly: 89.94, like: "II" }, risePct: 22 });
  });

  it("says II and III would land above today's III and IV, never at them", () => {
    const floors = proposedFloors(SAN_JOSE)!;

    expect(floors[1]).toMatchObject({ level: "II", proposed: { kind: "above", yearly: 221_374, like: "III" }, risePct: 18 });
    expect(floors[2]).toMatchObject({ level: "III", proposed: { kind: "above", yearly: 255_653, like: "IV" }, risePct: 15 });
  });

  it("leaves Level IV unknown: DOL publishes nothing as high as the 88th percentile", () => {
    const floors = proposedFloors(SAN_JOSE)!;

    expect(floors[3]).toEqual({ level: "IV", today: SAN_JOSE[3], proposed: { kind: "unknown" }, risePct: null });
  });

  it("rests on the percentiles the proposal prints", () => {
    // The whole reading depends on these two facts: the new I is today's II's percentile, and the new II and III
    // sit just above today's III and IV.
    expect(LEVEL_PERCENTILES.I.proposed).toBe(LEVEL_PERCENTILES.II.today);
    expect(LEVEL_PERCENTILES.II.proposed).toBeGreaterThan(LEVEL_PERCENTILES.III.today);
    expect(LEVEL_PERCENTILES.III.proposed).toBeGreaterThan(LEVEL_PERCENTILES.IV.today);
    expect(LEVEL_PERCENTILES.IV.proposed).toBeGreaterThan(LEVEL_PERCENTILES.IV.today);
  });

  it("reads the levels whatever order they arrive in", () => {
    expect(proposedFloors([...SAN_JOSE].reverse())![0]!.proposed).toMatchObject({ kind: "about", yearly: 187_075 });
  });

  it("says nothing for a table it can't read across", () => {
    expect(proposedFloors(SAN_JOSE.slice(0, 3))).toBeNull();
    expect(proposedFloors(SAN_JOSE.map((l) => (l.level === "II" ? { ...l, yearly: 0 } : l)))).toBeNull();
    // Levels out of order are a broken row, never a pay cut.
    expect(proposedFloors(SAN_JOSE.map((l) => (l.level === "III" ? { ...l, yearly: 100_000 } : l)))).toBeNull();
    expect(proposedFloors([])).toBeNull();
  });
});
