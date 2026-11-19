import { describe, expect, it } from "vitest";

import { decisionTrend, deniedShare, everyMonth, leadLine, parseUscisMonthly, recentMonths } from "../uscisMonthly";

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

describe("each month in a row, and the newest month against the year before (the N-400 drop, Nov 19 2026)", () => {
  // Two years of one form, oldest first: 80,000 decided a month in the earlier year, 20,000 in the newest month, with
  // one month of the earlier year that USCIS's listing doesn't carry.
  const months: string[] = [];
  for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
  const held = months.filter((m) => m >= "2024-10" && m <= "2026-09" && m !== "2024-12");
  const pts = held.map((m) => ({
    month: m, received: 50000,
    approved: m === "2026-09" ? 16000 : m <= "2025-09" ? 72000 : 30000,
    denied: m === "2026-09" ? 4000 : m <= "2025-09" ? 8000 : 5000,
    pending: m === "2026-09" ? 840000 : m === "2025-09" ? 540000 : 600000,
    pending_6mo: 100, avg_months: 10,
  }));
  const twoYears = parseUscisMonthly(JSON.stringify({
    newest: "2026-09", months: held, missing: ["2024-12"], source: "USCIS",
    lines: [{ form: "N-400", line: "Application for Naturalization", basis: "", points: pts }],
  }))!;
  const line = leadLine(twoYears, "N-400")!;

  it("lists every month from the first held to the newest, oldest first, a missing month as a gap", () => {
    const all = everyMonth(twoYears, line);
    expect(all[0]!.month).toBe("2024-10");
    expect(all.at(-1)!.month).toBe("2026-09");
    expect(all).toHaveLength(24);
    expect(all.find((m) => m.month === "2024-12")!.point).toBeNull();
  });

  it("sets the newest month's decisions against the monthly average of the year before, over the months USCIS reported", () => {
    const t = decisionTrend(twoYears, line)!;
    expect(t.month).toBe("2026-09");
    expect(t.decided).toBe(20000);
    // Oct 2024 to Sep 2025 is 12 months; December 2024 isn't listed, so 11 count.
    expect(t.before).toEqual({ from: "2024-10", to: "2025-09", average: 80000, counted: 11 });
    expect(t.share).toBeCloseTo(0.25, 5);
    expect(t.pending).toBe(840000);
    expect(t.pendingYearAgo).toBe(540000);
  });

  it("says nothing it can't count: fewer than six months a year before, or no decisions in the newest month", () => {
    const short = parseUscisMonthly(JSON.stringify({
      newest: "2026-09", months: ["2025-08", "2025-09", "2026-09"], missing: [], source: "USCIS",
      lines: [{ form: "N-400", line: "x", basis: "", points: pts.filter((p) => ["2025-08", "2025-09", "2026-09"].includes(p.month)) }],
    }))!;
    expect(decisionTrend(short, leadLine(short, "N-400")!)!.before).toBeNull();
    const blank = parseUscisMonthly(JSON.stringify({
      newest: "2026-09", months: held, missing: [], source: "USCIS",
      lines: [{ form: "N-400", line: "x", basis: "", points: pts.map((p) => (p.month === "2026-09" ? { ...p, approved: null } : p)) }],
    }))!;
    expect(decisionTrend(blank, leadLine(blank, "N-400")!)).toBeNull();
  });
});
