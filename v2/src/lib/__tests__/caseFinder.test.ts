import { describe, expect, it } from "vitest";

import type { DayCase } from "@/lib/filingDay";

import { enoughTyped, findOnDay, jobFits, nameFits, nearbyDays } from "../caseFinder";

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

describe("findOnDay", () => {
  const day = [
    c("G-100-26030-000003", "Microsoft Corporation"),
    c("G-100-26030-000001", "Google LLC", true),
    c("G-100-26030-000002", "GOOGLE LLC"),
    c("G-100-26030-000004", "Goggle Optics Inc", true, "DENIED"),
    c("G-100-26030-000005", "Meta Platforms, Inc.", true, "WITHDRAWN"),
  ];

  it("counts the whole day whatever was typed", () => {
    expect(findOnDay(day, "").day).toEqual({ filed: 5, decided: 3, waiting: 2 });
    expect(findOnDay(day, "google").day).toEqual({ filed: 5, decided: 3, waiting: 2 });
    expect(findOnDay([], "google")).toEqual({ matches: [], ofEmployer: 0, close: [], day: { filed: 0, decided: 0, waiting: 0 } });
  });

  it("lists the employer's cases that day, in order, and offers no guesses beside them", () => {
    const got = findOnDay(day, "Google Inc");
    // Two spellings of one company, kept together and in number order.
    expect(got.matches.map((m) => m.caseNumber)).toEqual(["G-100-26030-000001", "G-100-26030-000002"]);
    expect(got.close).toEqual([]);
  });

  it("narrows a big employer's cases by words of the job title, and still says how many the employer filed", () => {
    const big = [
      c("G-100-26030-000011", "Amazon Web Services, Inc.", false, "ANALYST REVIEW", "Software Dev Engineer III"),
      c("G-100-26030-000012", "Amazon.com Services LLC", true, "CERTIFIED", "Sr. Product Manager - Tech"),
      c("G-100-26030-000013", "Amazon Data Services, Inc.", true, "CERTIFIED", "Software Dev Engineer II"),
      c("G-100-26030-000014", "Other Co", false, "ANALYST REVIEW", "Software Dev Engineer III"),
    ];
    const got = findOnDay(big, "amazon", "engineer iii");
    expect(got.ofEmployer).toBe(3);
    expect(got.matches.map((m) => m.caseNumber)).toEqual(["G-100-26030-000011"]);
    // A job nobody there holds leaves the employer's count and no cases, and it guesses no other name.
    expect(findOnDay(big, "amazon", "welder")).toMatchObject({ matches: [], ofEmployer: 3, close: [] });
    // An empty job box narrows nothing.
    expect(findOnDay(big, "amazon", "  ").matches).toHaveLength(3);
  });

  it("matches nothing until two letters are typed", () => {
    expect(findOnDay(day, "g").matches).toEqual([]);
    expect(findOnDay(day, "g").close).toEqual([]);
  });

  it("offers the day's closest spellings when the name fits none, busiest first among equals", () => {
    const got = findOnDay(day, "Gogle");
    expect(got.matches).toEqual([]);
    // Both spellings of Google are one company, so its chip carries both cases.
    expect(got.close[0]).toEqual({ employer: "Google LLC", cases: 2 });
    expect(got.close.map((n) => n.employer)).toContain("Goggle Optics Inc");
    expect(got.close.map((n) => n.employer)).not.toContain("Meta Platforms, Inc.");
  });

  it("offers one company once however DOL printed it, under its commonest spelling, with its cases together", () => {
    const printed = [
      c("G-100-26030-000021", "Amazon Web Services, Inc."),
      c("G-100-26030-000022", "Amazon Web Services, Inc."),
      c("G-100-26030-000023", "AMAZON WEB SERVICES, INC."),
      c("G-100-26030-000024", "Amazon Web Services, INC"),
      c("G-100-26030-000025", "Amazon Data Services, Inc."),
    ];
    const got = findOnDay(printed, "amazn web servces");
    expect(got.close[0]).toEqual({ employer: "Amazon Web Services, Inc.", cases: 4 });
    expect(got.close.filter((n) => /web services/i.test(n.employer))).toHaveLength(1);
    // Picking the chip types its name, and every spelling fits it.
    expect(findOnDay(printed, got.close[0]!.employer).ofEmployer).toBe(4);
  });

  it("offers nothing when no name on the day is close", () => {
    expect(findOnDay(day, "Zzyzx Qwerty")).toMatchObject({ matches: [], close: [] });
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
