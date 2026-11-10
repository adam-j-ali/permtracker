import { describe, expect, it } from "vitest";

import type { DayCase } from "@/lib/filingDay";

import {
  WINDOW_MAX_DAYS,
  askedAnything,
  closeNamesAmong,
  employerStem,
  enoughTyped,
  finderWindow,
  firmFits,
  jobFits,
  matchFound,
  nameFits,
  nearbyDays,
  typedWords,
  windowDays,
  type FoundCase,
} from "../caseFinder";

const c = (caseNumber: string, employer: string, final = false, status = final ? "CERTIFIED" : "ANALYST REVIEW", jobTitle = "Software Engineer"): DayCase => ({
  caseNumber, status, employer, employerSlug: null, jobTitle, final,
});

describe("nameFits", () => {
  it("ignores the form words, the case and the punctuation", () => {
    expect(nameFits("google inc", "GOOGLE LLC")).toBe(true);
    expect(nameFits("Google, L.L.C.", "Google LLC")).toBe(true);
    expect(nameFits("jackson lewis", "Jackson Lewis P.C.")).toBe(true);
  });

  it("takes the start of a word, so a name fits while it's still being typed", () => {
    expect(nameFits("micro", "Microsoft Corporation")).toBe(true);
    expect(nameFits("amazon web", "Amazon Web Services, Inc.")).toBe(true);
    // The middle of a word is somebody else's company.
    expect(nameFits("soft", "Microsoft Corporation")).toBe(false);
  });

  it("needs every typed word", () => {
    expect(nameFits("amazon data", "Amazon Web Services, Inc.")).toBe(false);
    expect(nameFits("amazon", "Amazon.com Services LLC")).toBe(true);
  });

  it("fits a name spaced or hyphenated another way", () => {
    expect(nameFits("wal mart", "Walmart Inc.")).toBe(true);
    expect(nameFits("walmart", "Wal-Mart Associates, Inc.")).toBe(true);
    expect(nameFits("jpmorgan", "JP Morgan Chase & Co.")).toBe(true);
    expect(nameFits("morganchase", "JP Morgan Chase & Co.")).toBe(true);
    // Run together, it still has to start at a word.
    expect(nameFits("organchase", "JP Morgan Chase & Co.")).toBe(false);
  });

  it("reads the legal name before a trade name", () => {
    expect(nameFits("acme holdings", "Acme Holdings d/b/a Zenith Staffing")).toBe(true);
    expect(nameFits("zenith", "Acme Holdings d/b/a Zenith Staffing")).toBe(false);
  });

  it("fits nothing on an empty name or one of form words alone", () => {
    expect(nameFits("", "Google LLC")).toBe(false);
    expect(nameFits("   ", "Google LLC")).toBe(false);
  });
});

describe("jobFits", () => {
  it("wants every typed word somewhere in the title, whatever the case and punctuation", () => {
    expect(jobFits("sr product", "Sr. Product Manager - Tech")).toBe(true);
    expect(jobFits("manager tech", "Sr. Product Manager - Tech")).toBe(true);
    expect(jobFits("product designer", "Sr. Product Manager - Tech")).toBe(false);
    expect(jobFits("", "Anything")).toBe(true);
  });
});

describe("enoughTyped", () => {
  it("wants two letters or digits, whatever else is typed", () => {
    expect(enoughTyped("g")).toBe(false);
    expect(enoughTyped(" g. ")).toBe(false);
    expect(enoughTyped("3m")).toBe(true);
    expect(enoughTyped("go")).toBe(true);
  });
});

describe("nearbyDays", () => {
  it("folds a search's rows to their days, nearest first, without the asked day or undated rows", () => {
    const rows = [
      { filedOn: "2026-02-03" }, { filedOn: "2026-01-29" }, { filedOn: "2026-01-29" },
      { filedOn: "2026-01-30" }, { filedOn: null }, { filedOn: "2026-01-31" },
    ];
    expect(nearbyDays(rows, "2026-01-30")).toEqual([
      { day: "2026-01-29", cases: 2 },
      { day: "2026-01-31", cases: 1 },
      { day: "2026-02-03", cases: 1 },
    ]);
    expect(nearbyDays([], "2026-01-30")).toEqual([]);
  });
});

// The finder takes a window of days and any of an employer, a job title and a law firm (owner, Nov 10 2026:
// "time range rather than exact date ... each optional, need to fill in at least one thing").
const TODAY = "2026-11-10";
const EARLIEST = "2019-10-01";
const ask = (over: Partial<{ employer: string; title: string; firm: string; from: string; to: string }> = {}) => ({
  employer: "", title: "", firm: "", from: "", to: "", ...over,
});
const found = (caseNumber: string, employer: string, filedOn: string, over: Partial<FoundCase> = {}): FoundCase => ({
  ...c(caseNumber, employer), filedOn, ...over,
});

describe("finderWindow", () => {
  it("reads two dates as a window, in either order", () => {
    expect(finderWindow(ask({ from: "2026-01-05", to: "2026-01-31" }), TODAY, EARLIEST)).toEqual({ ok: true, from: "2026-01-05", to: "2026-01-31", assumed: false });
    expect(finderWindow(ask({ from: "2026-01-31", to: "2026-01-05" }), TODAY, EARLIEST)).toEqual({ ok: true, from: "2026-01-05", to: "2026-01-31", assumed: false });
  });

  it("reads one date alone as that one day, whichever box holds it", () => {
    expect(finderWindow(ask({ from: "2026-01-05" }), TODAY, EARLIEST)).toEqual({ ok: true, from: "2026-01-05", to: "2026-01-05", assumed: false });
    expect(finderWindow(ask({ to: "2026-01-05" }), TODAY, EARLIEST)).toEqual({ ok: true, from: "2026-01-05", to: "2026-01-05", assumed: false });
  });

  it("assumes the newest quarter when no date is given, and says it was assumed", () => {
    const w = finderWindow(ask(), TODAY, EARLIEST);
    expect(w).toEqual({ ok: true, from: "2026-08-11", to: TODAY, assumed: true });
    expect(w.ok && windowDays(w.from, w.to)).toBe(WINDOW_MAX_DAYS);
  });

  it("takes a quarter whole and calls a day more too long, with the days it read", () => {
    expect(finderWindow(ask({ from: "2026-01-01", to: "2026-04-02" }), TODAY, EARLIEST)).toMatchObject({ ok: true });
    expect(finderWindow(ask({ from: "2026-01-01", to: "2026-04-03" }), TODAY, EARLIEST)).toEqual({ ok: false, why: "too-long", from: "2026-01-01", to: "2026-04-03" });
  });

  it("cuts a window to the days the lists hold, and refuses one wholly outside them", () => {
    expect(finderWindow(ask({ from: "2019-09-20", to: "2019-10-05" }), TODAY, EARLIEST)).toMatchObject({ ok: true, from: EARLIEST, to: "2019-10-05" });
    expect(finderWindow(ask({ from: "2026-11-01", to: "2026-12-01" }), TODAY, EARLIEST)).toMatchObject({ ok: true, from: "2026-11-01", to: TODAY });
    expect(finderWindow(ask({ from: "2018-01-01", to: "2018-02-01" }), TODAY, EARLIEST)).toEqual({ ok: false, why: "too-early" });
    expect(finderWindow(ask({ from: "2026-11-11" }), TODAY, EARLIEST)).toEqual({ ok: false, why: "not-yet" });
  });

  it("refuses a date that isn't a real day", () => {
    expect(finderWindow(ask({ from: "2026-02-30" }), TODAY, EARLIEST)).toEqual({ ok: false, why: "bad-date" });
    expect(finderWindow(ask({ to: "01/05/2026" }), TODAY, EARLIEST)).toEqual({ ok: false, why: "bad-date" });
  });

  it("counts both ends of a window", () => {
    expect(windowDays("2026-01-05", "2026-01-05")).toBe(1);
    expect(windowDays("2026-01-01", "2026-01-31")).toBe(31);
  });
});

describe("askedAnything", () => {
  it("is true for any one filled box or any date, and false for nothing or a single letter", () => {
    expect(askedAnything(ask())).toBe(false);
    expect(askedAnything(ask({ employer: "a" }))).toBe(false);
    expect(askedAnything(ask({ employer: "ac" }))).toBe(true);
    expect(askedAnything(ask({ title: "engineer" }))).toBe(true);
    expect(askedAnything(ask({ firm: "fragomen" }))).toBe(true);
    expect(askedAnything(ask({ from: "2026-01-05" }))).toBe(true);
    expect(askedAnything(ask({ to: "2026-01-05" }))).toBe(true);
  });
});

describe("firmFits", () => {
  it("wants every typed word somewhere in the firm's printed name", () => {
    expect(firmFits("fragomen", "Fragomen, Del Rey, Bernsen & Loewy, LLP")).toBe(true);
    expect(firmFits("del rey fragomen", "Fragomen, Del Rey, Bernsen & Loewy, LLP")).toBe(true);
    expect(firmFits("fragomen smith", "Fragomen, Del Rey, Bernsen & Loewy, LLP")).toBe(false);
  });

  it("fits no case that names no firm, and every case when nothing is typed", () => {
    expect(firmFits("fragomen", null)).toBe(false);
    expect(firmFits("fragomen", "")).toBe(false);
    expect(firmFits("", null)).toBe(true);
  });
});

describe("employerStem", () => {
  it("is the start of the name's first key word, three letters at most", () => {
    expect(employerStem("Microsoft Corporation")).toBe("mic");
    expect(employerStem("jp morgan")).toBe("jp");
    expect(employerStem("The Boeing Company")).toBe(employerStem("boeing"));
    expect(employerStem("  ")).toBe("");
  });

  // The database narrows a window by the stem before the exact rule runs, so it must never drop a name the rule fits.
  it("is in every printed name the rule fits, once the name's spaces and punctuation are taken out", () => {
    const squeezed = (name: string) => name.toLowerCase().replace(/[ .,&\-'/]/g, "");
    const pairs: [string, string][] = [
      ["google inc", "GOOGLE LLC"],
      ["micro", "Microsoft Corporation"],
      ["amazon web", "Amazon Web Services, Inc."],
      ["wal mart", "Walmart Inc."],
      ["walmart", "Wal-Mart Associates, Inc."],
      ["jpmorgan", "JP Morgan Chase & Co."],
      ["morganchase", "JP Morgan Chase & Co."],
      ["morgan", "JP Morgan Chase & Co."],
      ["acme holdings", "Acme Holdings d/b/a Zenith Staffing"],
      ["att", "AT&T Services, Inc."],
      ["abc", "A.B.C. Trucking, Inc."],
      ["oreilly", "O'Reilly Auto Parts"],
      ["ernst young", "Ernst & Young U.S. LLP"],
    ];
    for (const [typed, printed] of pairs) {
      if (!nameFits(typed, printed)) continue;
      expect(squeezed(printed), `${typed} in ${printed}`).toContain(employerStem(typed));
    }
    // Enough of the pairs fit for the loop to mean something.
    expect(pairs.filter(([typed, printed]) => nameFits(typed, printed)).length).toBeGreaterThanOrEqual(10);
  });
});

describe("typedWords", () => {
  it("gives the letters and digits typed, lower case, as words", () => {
    expect(typedWords("  Sr. Software-Engineer II ")).toEqual(["sr", "software", "engineer", "ii"]);
    expect(typedWords("%_")).toEqual([]);
  });
});

describe("matchFound", () => {
  const rows = [
    found("G-1", "Acme Robotics LLC", "2026-01-05", { jobTitle: "Data Scientist", firm: "Fragomen, Del Rey, Bernsen & Loewy, LLP" }),
    found("G-2", "ACME ROBOTICS, L.L.C.", "2026-01-20", { jobTitle: "Software Engineer", firm: null }),
    found("G-3", "Zenith Foods Inc", "2026-01-12", { jobTitle: "Data Scientist", firm: "Smith Immigration PC" }),
    found("G-4", "Acme Robotics LLC", "2026-01-20", { jobTitle: "Software Engineer II", firm: "Smith Immigration PC" }),
  ];

  it("keeps every row when no box is filled, the newest filing first", () => {
    expect(matchFound(rows, ask()).map((r) => r.caseNumber)).toEqual(["G-2", "G-4", "G-3", "G-1"]);
  });

  it("fits a job title alone, across employers", () => {
    expect(matchFound(rows, ask({ title: "data scientist" })).map((r) => r.caseNumber)).toEqual(["G-3", "G-1"]);
  });

  it("fits a law firm alone, and never a case that names no firm", () => {
    expect(matchFound(rows, ask({ firm: "smith" })).map((r) => r.caseNumber)).toEqual(["G-4", "G-3"]);
  });

  it("fits an employer whatever its spelling, its cases together, the newest first", () => {
    expect(matchFound(rows, ask({ employer: "acme robotics" })).map((r) => r.caseNumber)).toEqual(["G-2", "G-4", "G-1"]);
  });

  it("needs every filled box to fit", () => {
    expect(matchFound(rows, ask({ employer: "acme", title: "engineer", firm: "smith" })).map((r) => r.caseNumber)).toEqual(["G-4"]);
    expect(matchFound(rows, ask({ employer: "zenith", title: "engineer" }))).toEqual([]);
  });

  it("doesn't count a single letter as a filled box", () => {
    expect(matchFound(rows, ask({ employer: "z", firm: "s" }))).toHaveLength(4);
  });
});

describe("closeNamesAmong", () => {
  it("ranks a window's employers by how close their spelling is, one company once", () => {
    const names = [
      { employer: "Microsoft Corporation", cases: 40 },
      { employer: "MICROSOFT CORPORATION", cases: 2 },
      { employer: "Micron Technology, Inc.", cases: 9 },
      { employer: "Zenith Foods Inc", cases: 1 },
    ];
    const close = closeNamesAmong(names, "mircosoft");
    expect(close[0]).toEqual({ employer: "Microsoft Corporation", cases: 42 });
    expect(close.map((n) => n.employer)).not.toContain("Zenith Foods Inc");
  });

  it("puts the busiest first among names equally close, and writes a company in its commonest spelling", () => {
    const names = [
      { employer: "ACME ROBOTICS INC", cases: 1 },
      { employer: "Acme Robotics, Inc.", cases: 1 },
      { employer: "Acme Robotics LLC", cases: 7 },
    ];
    // "Inc" and "LLC" are form words, so the three are one company: its commonest spelling leads, and between
    // spellings equally common the one with fewer capitals.
    expect(closeNamesAmong(names, "acmee robotcs")).toEqual([{ employer: "Acme Robotics LLC", cases: 9 }]);
    expect(closeNamesAmong(names.slice(0, 2), "acmee robotcs")).toEqual([{ employer: "Acme Robotics, Inc.", cases: 2 }]);
  });

  it("offers nothing when no name is close, and skips a row with no name", () => {
    expect(closeNamesAmong([{ employer: "Zenith Foods Inc", cases: 1 }, { employer: "", cases: 50 }], "qqqqqq")).toEqual([]);
  });
});
