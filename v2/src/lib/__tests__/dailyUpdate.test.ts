import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EXPIRY, PERM_BUCKETS, dayCases, daysBefore, monthsToDraw, shareLabel, shareLine, summariseDay, trendAgainst } from "@/lib/dailyUpdate";
import { usualFor } from "@/lib/pulseStats";
import type { ActivityDay } from "@/lib/activityStats";
import type { CaseChange } from "@/lib/db/changes";

let serial = 0;
/** One move of one case. A new case number each call unless one is given. */
function move(over: Partial<CaseChange> = {}): CaseChange {
  serial += 1;
  return {
    caseNumber: `G-100-26030-${String(600000 + serial)}`,
    program: "perm",
    observedOn: "2026-11-10",
    fromStatus: "ANALYST REVIEW",
    toStatus: "CERTIFIED",
    isFinal: true,
    employerName: "An employer",
    employerSlug: "an-employer",
    jobTitle: "A job",
    filingDate: "2026-01-30",
    ...over,
  };
}

/** `n` certifications filed on `day`. */
const certified = (n: number, day: string | null) => Array.from({ length: n }, () => move({ filingDate: day }));

describe("summariseDay", () => {
  it("counts each way a PERM case ended, and the cases an analyst asked about", () => {
    // Arrange
    const day = [
      ...certified(5, "2026-01-30"),
      move({ toStatus: "DENIED" }),
      move({ toStatus: "DENIED" }),
      move({ toStatus: "WITHDRAWN" }),
      move({ toStatus: "RFI ISSUED", isFinal: false }),
      move({ fromStatus: "RFI ISSUED", toStatus: "ANALYST REVIEW", isFinal: false }),
    ];

    // Act
    const u = summariseDay("2026-11-10", day);

    // Assert
    expect(u).toMatchObject({ date: "2026-11-10", certified: 5, denied: 2, withdrawn: 1, asked: 1, total: 10 });
    expect(u.other).toBe(1);
  });

  it("reads one program at a time: a wage request's move is no PERM decision", () => {
    const day = [...certified(2, "2026-01-30"), move({ program: "pwd", fromStatus: "IN PROCESS", toStatus: "DETERMINATION ISSUED", filingDate: "2026-06-01" })];

    expect(summariseDay("2026-11-10", day).certified).toBe(2);
    expect(summariseDay("2026-11-10", day).total).toBe(2);
    // A wage request ends well with an issued determination, by its own program's rule.
    expect(summariseDay("2026-11-10", day, "pwd")).toMatchObject({ certified: 1, total: 1 });
  });

  it("never counts a certification's own lapse: DOL's relabel isn't a decision", () => {
    const day = [move({ fromStatus: "CERTIFIED", toStatus: "CERTIFIED - EXPIRED" }), ...certified(1, "2026-01-30")];

    const u = summariseDay("2026-11-10", day);

    expect(u.certified).toBe(1);
    expect(u.other).toBe(1);
  });

  it("counts a day's PERM decisions by the buckets the daily series uses, so the two can't disagree", () => {
    // The fixture the ingest's own test reads (scripts/test_observed_decisions.py).
    const fx = JSON.parse(readFileSync(resolve(process.cwd(), "scripts/fixtures/decision_buckets.json"), "utf8")) as {
      buckets: Record<string, "certified" | "denied" | "withdrawn">;
      expiry: { from: string; to: string };
    };
    expect(PERM_BUCKETS).toEqual(fx.buckets);
    expect(EXPIRY).toEqual(fx.expiry);

    // One move into each status that ends a case, from review.
    const day = Object.keys(fx.buckets).map((toStatus) => move({ toStatus }));
    const u = summariseDay("2026-11-10", day);
    const want = { certified: 0, denied: 0, withdrawn: 0 };
    for (const b of Object.values(fx.buckets)) want[b] += 1;

    expect({ certified: u.certified, denied: u.denied, withdrawn: u.withdrawn }).toEqual(want);
    // An appeal board's dismissal ends the case denied, as the series counts it.
    expect(summariseDay("2026-11-10", [move({ fromStatus: "BALCA APPEALS", toStatus: "DENIED - BALCA DISMISSED" })]).denied).toBe(1);
  });

  it("counts every move, as the series does: a case denied, reopened and certified in a day is one of each", () => {
    const one = "G-100-26030-111111";
    const day = [
      move({ caseNumber: one, fromStatus: "ANALYST REVIEW", toStatus: "DENIED" }),
      move({ caseNumber: one, fromStatus: "DENIED", toStatus: "RECONSIDERATION APPEALS", isFinal: false }),
      move({ caseNumber: one, fromStatus: "RECONSIDERATION APPEALS", toStatus: "CERTIFIED" }),
    ];

    const u = summariseDay("2026-11-10", day);

    expect(u).toMatchObject({ certified: 1, denied: 1, other: 1, total: 3 });
  });

  it("gives the filing days of the certified cases: the whole span, the middle 8 in 10, and the busiest day", () => {
    // 100 certifications: one old straggler, one far ahead of the rest, the bulk across four days.
    const day = [
      ...certified(1, "2024-12-05"),
      ...certified(20, "2026-01-23"),
      ...certified(40, "2026-01-30"),
      ...certified(30, "2026-02-02"),
      ...certified(8, "2026-02-04"),
      ...certified(1, "2026-02-26"),
    ];

    const u = summariseDay("2026-11-10", day);

    expect(u.certifiedFiled).toEqual({ oldest: "2024-12-05", newest: "2026-02-26", n: 100 });
    // The straggler and the one far ahead sit outside the middle 8 in 10.
    expect(u.certifiedCore).toEqual({ from: "2026-01-23", to: "2026-02-02" });
    expect(u.busiestFilingDay).toEqual({ day: "2026-01-30", n: 40 });
    expect(u.certifiedByMonth).toEqual([
      { month: "2024-12", n: 1 },
      { month: "2026-01", n: 60 },
      { month: "2026-02", n: 39 },
    ]);
  });

  it("leaves the filing days out when too few cases carry one to describe", () => {
    const u = summariseDay("2026-11-10", [...certified(3, null), ...certified(2, "2026-01-30")]);

    expect(u.certified).toBe(5);
    // Two dated cases are a span, never "8 in 10".
    expect(u.certifiedFiled).toEqual({ oldest: "2026-01-30", newest: "2026-01-30", n: 2 });
    expect(u.certifiedCore).toBeNull();
  });

  it("is all zeros, with nothing to describe, for a day with no moves", () => {
    const u = summariseDay("2026-11-11", []);

    expect(u).toMatchObject({ certified: 0, denied: 0, withdrawn: 0, asked: 0, other: 0, total: 0 });
    expect(u.certifiedFiled).toBeNull();
    expect(u.certifiedCore).toBeNull();
    expect(u.busiestFilingDay).toBeNull();
    expect(u.certifiedByMonth).toEqual([]);
  });

  it("ignores a filing date that isn't a date", () => {
    const u = summariseDay("2026-11-10", [...certified(1, "not a date"), ...certified(1, "2026-01-30")]);

    expect(u.certifiedFiled).toEqual({ oldest: "2026-01-30", newest: "2026-01-30", n: 1 });
  });
});

describe("shareLine", () => {
  const busy = summariseDay("2026-11-10", [
    ...certified(1, "2024-12-05"),
    ...certified(20, "2026-01-23"),
    ...certified(40, "2026-01-30"),
    ...certified(30, "2026-02-02"),
    ...certified(8, "2026-02-04"),
    ...certified(1, "2026-02-26"),
    move({ toStatus: "DENIED" }),
    move({ toStatus: "DENIED" }),
    move({ toStatus: "WITHDRAWN" }),
  ]);

  it("says the day, the count, where most were filed, and where the list is", () => {
    expect(shareLine(busy, { final: true })).toBe(
      "DOL certified 100 PERM cases on Tuesday, November 10. 8 in 10 were filed between January 23 and February 2, 2026. 2 denied, 1 withdrawn. Every case: permtracker.app/perm-updates/2026-11-10",
    );
  });

  it("says so far for a day DOL is still working", () => {
    expect(shareLine(busy, { final: false })).toContain("DOL has certified 100 PERM cases so far on Tuesday, November 10.");
  });

  it("uses one case's own grammar, and one filing day's", () => {
    const one = summariseDay("2026-11-10", certified(1, "2026-01-30"));

    expect(shareLine(one, { final: true })).toBe(
      "DOL certified 1 PERM case on Tuesday, November 10, filed January 30, 2026. Every case: permtracker.app/perm-updates/2026-11-10",
    );
  });

  it("names both years when the middle span crosses one", () => {
    const crossing = summariseDay("2026-11-10", [...certified(30, "2025-12-15"), ...certified(30, "2026-01-30")]);

    expect(shareLine(crossing, { final: true })).toContain("8 in 10 were filed between December 15, 2025 and January 30, 2026.");
  });

  it("never says zero as if it were news: a day with no certification says what did happen", () => {
    const quiet = summariseDay("2026-11-11", [move({ observedOn: "2026-11-11", toStatus: "WITHDRAWN" }), move({ observedOn: "2026-11-11", toStatus: "WITHDRAWN" })]);

    expect(shareLine(quiet, { final: false })).toBe(
      "DOL hasn't certified a PERM case yet on Wednesday, November 11. 2 withdrawn. Every case: permtracker.app/perm-updates/2026-11-11",
    );
    expect(shareLine(summariseDay("2026-11-08", []), { final: true })).toBe(
      "DOL recorded no PERM decision on Sunday, November 8. Every day: permtracker.app/perm-updates",
    );
  });
});

describe("dayCases", () => {
  it("lists each move of the program with the status it moved to and its filing day", () => {
    const rows = dayCases(
      [
        move({ caseNumber: "G-100-26030-000001", toStatus: "certified", employerName: "Acme Inc", employerSlug: "acme-inc", jobTitle: "Engineer", filingDate: "2026-01-30" }),
        move({ caseNumber: "G-100-26030-000002", toStatus: "RFI ISSUED", isFinal: false, employerName: null, employerSlug: null, jobTitle: null, filingDate: null }),
        move({ program: "pwd", toStatus: "DETERMINATION ISSUED" }),
      ],
      "perm",
    );

    expect(rows).toEqual([
      { caseNumber: "G-100-26030-000001", status: "CERTIFIED", employer: "Acme Inc", employerSlug: "acme-inc", jobTitle: "Engineer", final: true, filedOn: "2026-01-30" },
      // A case the record hasn't named yet keeps its row, with nothing made up for the blanks.
      { caseNumber: "G-100-26030-000002", status: "RFI ISSUED", employer: "", employerSlug: null, jobTitle: "", final: false },
    ]);
  });
});

/** A series row. Nov 10 2026 is a Tuesday. */
const on = (date: string, certified: number): ActivityDay => ({ date, total: certified, certified, denied: 0, withdrawn: 0 });

describe("usualFor", () => {
  const series = [on("2026-10-13", 600), on("2026-10-20", 700), on("2026-10-27", 800), on("2026-11-03", 500), on("2026-11-09", 9999), on("2026-11-10", 766)];

  it("is the mean of the same weekday in the weeks before, never the day itself or another weekday", () => {
    expect(usualFor(series, "2026-11-10", "certified")).toEqual({ usual: 650, compared: 4 });
  });

  it("looks back only as many weeks as asked", () => {
    expect(usualFor(series, "2026-11-10", "certified", 2)).toEqual({ usual: 650, compared: 2 });
    expect(usualFor(series, "2026-11-10", "certified", 1)).toEqual({ usual: 500, compared: 1 });
  });

  it("leaves a federal holiday out, where DOL was closed", () => {
    // Wednesday Nov 11 2026 is Veterans Day; the Wednesdays before it are ordinary.
    const wednesdays = [on("2026-10-28", 400), on("2026-11-04", 600), on("2026-11-11", 0)];
    expect(usualFor(wednesdays, "2026-11-18", "certified")).toEqual({ usual: 500, compared: 2 });
  });

  it("is null with no earlier day to compare with", () => {
    expect(usualFor([on("2026-11-10", 766)], "2026-11-10", "certified")).toBeNull();
  });
});

describe("trendAgainst", () => {
  it("says which way, by how much, against what, and whether that's good", () => {
    expect(trendAgainst(766, 650, "Tuesday", "good")).toEqual({ text: "18% above a usual Tuesday (650)", dir: "up", tone: "good" });
    expect(trendAgainst(500, 650, "Tuesday", "good")).toEqual({ text: "23% below a usual Tuesday (650)", dir: "down", tone: "bad" });
  });

  it("reads more denials as bad and fewer as good", () => {
    expect(trendAgainst(40, 20, "Tuesday", "bad")?.tone).toBe("bad");
    expect(trendAgainst(10, 20, "Tuesday", "bad")?.tone).toBe("good");
  });

  it("compares a small count in cases: 40 denials against 19 is 21 more, never 111% above", () => {
    expect(trendAgainst(40, 19, "Tuesday", "bad")).toEqual({ text: "21 more than a usual Tuesday (19)", dir: "up", tone: "bad" });
    expect(trendAgainst(11, 14, "Tuesday", "info")).toEqual({ text: "3 fewer than a usual Tuesday (14)", dir: "down", tone: "info" });
    // One case either way is the usual day.
    expect(trendAgainst(15, 14, "Tuesday", "info")?.dir).toBe("level");
  });

  it("calls a change that's neither good nor bad information", () => {
    expect(trendAgainst(30, 20, "Tuesday", "info")?.tone).toBe("info");
  });

  it("reads within 5% as level", () => {
    expect(trendAgainst(660, 650, "Tuesday", "good")).toEqual({ text: "About a usual Tuesday (650)", dir: "level", tone: "neutral" });
  });

  it("says nothing with no usual to stand against", () => {
    expect(trendAgainst(766, null, "Tuesday", "good")).toBeNull();
    expect(trendAgainst(766, 0, "Tuesday", "good")).toBeNull();
  });
});

describe("daysBefore", () => {
  it("gives the days before with a decision, newest first", () => {
    const series = [on("2026-11-06", 540), on("2026-11-07", 0), on("2026-11-09", 627), on("2026-11-10", 766)];

    expect(daysBefore(series, "2026-11-10", 5).map((d) => d.date)).toEqual(["2026-11-09", "2026-11-06"]);
    expect(daysBefore(series, "2026-11-10", 1).map((d) => d.date)).toEqual(["2026-11-09"]);
  });

  it("leaves out a weekend or a holiday DOL certified nothing on, and keeps one it did", () => {
    // Sat Nov 7: two denials landed, nothing certified. Sat Oct 31: DOL certified 141 working overtime.
    const series: ActivityDay[] = [
      { date: "2026-10-31", total: 143, certified: 141, denied: 2, withdrawn: 0 },
      on("2026-11-06", 540),
      { date: "2026-11-07", total: 2, certified: 0, denied: 2, withdrawn: 0 },
      on("2026-11-09", 627),
    ];

    expect(daysBefore(series, "2026-11-10", 5).map((d) => d.date)).toEqual(["2026-11-09", "2026-11-06", "2026-10-31"]);
  });
});

describe("monthsToDraw", () => {
  // Nov 10 2026, as DOL's record had it.
  const months = [
    { month: "2024-12", n: 7 },
    { month: "2025-01", n: 2 },
    { month: "2025-08", n: 1 },
    { month: "2025-09", n: 3 },
    { month: "2025-11", n: 16 },
    { month: "2025-12", n: 117 },
    { month: "2026-01", n: 419 },
    { month: "2026-02", n: 201 },
  ];

  it("draws each month with 2% or more of the day and adds the small ones into one row", () => {
    const { rows, rest } = monthsToDraw(months, 766);

    expect(rows.map((m) => m.month)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(rest).toEqual({ n: 13, months: 4 });
    // Nothing is dropped: the rows and the rest are the whole day.
    expect(rows.reduce((a, m) => a + m.n, 0) + (rest?.n ?? 0)).toBe(766);
  });

  it("keeps a lone small month as its own named row", () => {
    const { rows, rest } = monthsToDraw([{ month: "2025-01", n: 1 }, { month: "2026-01", n: 99 }], 100);

    expect(rows.map((m) => m.month)).toEqual(["2025-01", "2026-01"]);
    expect(rest).toBeNull();
  });

  it("draws nothing for a day with no dated certification", () => {
    expect(monthsToDraw([], 0)).toEqual({ rows: [], rest: null });
  });
});

describe("shareLabel", () => {
  it("never prints 0% for a month that holds a case", () => {
    expect(shareLabel(2, 766)).toBe("under 1%");
    expect(shareLabel(419, 766)).toBe("55%");
    expect(shareLabel(0, 766)).toBe("0%");
  });
});
