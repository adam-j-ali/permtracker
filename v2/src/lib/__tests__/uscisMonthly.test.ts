import { describe, expect, it } from "vitest";

import { deniedShare, leadLine, parseUscisMonthly, recentMonths } from "../uscisMonthly";

/** USCIS's monthly report to Congress, as the pages read it: checked, a lead line per form, gaps kept as gaps. */
const point = (month: string, approved: number | null, denied: number | null) => ({
  month, received: 100, approved, denied, pending: 1000, pending_6mo: 500, avg_months: 12.9,
});
const doc = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    newest: "2026-09",
    months: ["2026-06", "2026-08", "2026-09"],
    missing: ["2026-07"],
    source: "USCIS",
    lines: [
      { form: "I-485", line: "Adjust Status (Employment)", basis: "Employment", points: [point("2026-09", 8068, 1497), point("2026-06", 12216, 1076), point("2026-08", 11694, 1323)] },
      { form: "I-485", line: "Adjust Status (Family)", basis: "Family", points: [point("2026-09", 26428, 5903)] },
      { form: "I-765", line: "Application for Employment Authorization", basis: "", points: [point("2026-09", 132180, 31973)] },
    ],
    ...extra,
  });

describe("USCIS's monthly report to Congress", () => {
  it("reads the doc, each line's months oldest first, and refuses what isn't it", () => {
    const d = parseUscisMonthly(doc())!;
    expect(d.newest).toBe("2026-09");
    expect(d.lines[0]!.points.map((p) => p.month)).toEqual(["2026-06", "2026-08", "2026-09"]);
    expect(parseUscisMonthly("not json")).toBeNull();
    expect(parseUscisMonthly(JSON.stringify({ lines: "x" }))).toBeNull();
  });

  it("keeps a missing figure as no figure, never a zero", () => {
    const d = parseUscisMonthly(doc({ lines: [{ form: "I-765", line: "x", basis: "", points: [{ month: "2026-09", received: null, approved: "lots" }] }] }))!;
    expect(d.lines[0]!.points[0]).toMatchObject({ received: null, approved: null, denied: null });
  });

  it("leads the I-485 page with the employment-based line, and every other form with its one line", () => {
    const d = parseUscisMonthly(doc())!;
    expect(leadLine(d, "I-485")?.basis).toBe("Employment");
    expect(leadLine(d, "I-765")?.form).toBe("I-765");
    expect(leadLine(d, "I-140")).toBeNull();
    expect(leadLine(null, "I-485")).toBeNull();
  });

  it("gives the denied share of what was decided", () => {
    expect(deniedShare(point("2026-09", 8068, 1497))).toBeCloseTo(1497 / 9565, 6);
    expect(deniedShare(point("2026-09", 0, 0))).toBeNull();
    expect(deniedShare(point("2026-09", null, 5))).toBeNull();
  });

  it("lists the last months newest first, a month USCIS doesn't list as its own empty row", () => {
    const d = parseUscisMonthly(doc())!;
    const rows = recentMonths(d, leadLine(d, "I-485")!, 12);
    expect(rows.map((r) => r.month)).toEqual(["2026-09", "2026-08", "2026-07", "2026-06"]);
    expect(rows[2]!.point).toBeNull();
    expect(rows[0]!.point?.approved).toBe(8068);
    expect(recentMonths(d, leadLine(d, "I-485")!, 2).map((r) => r.month)).toEqual(["2026-09", "2026-08"]);
  });
});
