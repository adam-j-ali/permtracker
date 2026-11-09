import { describe, expect, it } from "vitest";

import { caseMarks, congressNote, inquiryAnswer, medianLineFor, ombudsmanFrom, pickMedian, postedInSentence } from "../uscisInquiry";

/**
 * When a USCIS case can be asked about, from USCIS's posted cutoff and its own formula, and the note a congressional
 * office gets. Dates are calendar days: nothing reads a clock.
 */
describe("inquiryAnswer", () => {
  // USCIS's posting of Oct 19 2026: I-485, employment-based, its national office: cutoff Oct 28 2022.
  const published = "2026-10-19";
  const cutoff = "2022-10-28";

  it("says a receipt date before the cutoff can be asked about now", () => {
    expect(inquiryAnswer("2022-06-01", cutoff, published, "2026-11-09")).toEqual({ kind: "now", cutoff });
  });

  it("calls the cutoff day itself too close to call", () => {
    expect(inquiryAnswer(cutoff, cutoff, published, "2026-11-09").kind).toBe("edge");
  });

  it("dates a later receipt by USCIS's own formula: its 93% time added to the receipt date", () => {
    // Arrange: the 93% time is posting day minus cutoff, 1,452 days here.
    // Act
    const out = inquiryAnswer("2025-01-15", cutoff, published, "2026-11-09");
    // Assert
    expect(out).toEqual({ kind: "later", cutoff, from: "2029-01-06", days: 789 });
  });

  it("falls back to USCIS's six-month default where it posts no time", () => {
    expect(inquiryAnswer("2026-01-15", null, published, "2026-11-09")).toEqual({ kind: "default", from: "2026-07-15", now: true });
    expect(inquiryAnswer("2026-09-01", null, published, "2026-11-09")).toEqual({ kind: "default", from: "2027-03-01", now: false });
  });
});

describe("ombudsmanFrom", () => {
  it("waits 60 days after asking USCIS, and 45 after a congressional inquiry when that's later", () => {
    expect(ombudsmanFrom("2026-09-01", null)).toBe("2026-10-31");
    expect(ombudsmanFrom("2026-09-01", "2026-10-01")).toBe("2026-11-15");
    expect(ombudsmanFrom("2026-09-01", "2026-09-05")).toBe("2026-10-31");
  });
});

describe("congressNote", () => {
  const base = {
    name: "Worker A",
    receiptNumber: "MSC2290000000",
    form: "I-485, Application to Register Permanent Residence or Adjust Status (Employment-based)",
    filedOn: "June 1, 2022",
    office: "Service Center Operations",
    cutoff: "October 28, 2022",
    published: "October 19, 2026",
    askedUscis: "September 1, 2026",
    reference: "SRMT0000000000",
    extra: "",
  };

  it("states the facts, the cutoff and the inquiry, and offers the office's release", () => {
    // Act
    const note = congressNote(base);
    // Assert
    expect(note).toContain("Receipt number: MSC2290000000");
    expect(note).toContain("takes inquiries for cases received before October 28, 2022");
    expect(note).toContain("I asked USCIS about it on September 1, 2026 (reference SRMT0000000000)");
    expect(note).toContain("I'll sign your privacy release form");
  });

  it("never asks for a Social Security number, and leaves out what wasn't given", () => {
    const note = congressNote({ ...base, cutoff: null, askedUscis: "", reference: "", receiptNumber: "" });
    expect(note).not.toMatch(/social security|SSN/i);
    expect(note).not.toContain("takes inquiries");
    expect(note).not.toContain("I asked USCIS");
    expect(note).toContain("Receipt number: (add yours)");
  });
});

describe("caseMarks", () => {
  it("counts USCIS's months from the receipt date: whole months by the calendar, the rest as days", () => {
    // An employment-based I-485 received June 9, 2026: half done in 6.0 months, eight in ten in 9.5.
    expect(caseMarks("2026-06-09", 6, 9.5)).toEqual({ half: "2026-12-09", eightInTen: "2027-03-24" });
    // A tenth of a month is three days.
    expect(caseMarks("2026-01-31", 3.9, null).half).toBe("2026-05-27");
  });

  it("keeps a month's end from running into the next month", () => {
    // One month after January 31 is the end of February, in a leap year and out of one.
    expect(caseMarks("2026-01-31", 1, null).half).toBe("2026-02-28");
    expect(caseMarks("2028-01-31", 1, null).half).toBe("2028-02-29");
    expect(caseMarks("2026-11-30", null, 3).eightInTen).toBe("2027-02-28");
  });

  it("marks nothing where USCIS publishes no figure, or prints zero", () => {
    expect(caseMarks("2026-06-09", null, null)).toEqual({ half: null, eightInTen: null });
    expect(caseMarks("2026-06-09", 0, 0)).toEqual({ half: null, eightInTen: null });
  });
});

describe("medianLineFor", () => {
  it("matches a posted category to the quarterly line that counts the same cases", () => {
    expect(medianLineFor("I-485", "131A")).toBe("(Employment)");
    expect(medianLineFor("I-485", "131A-FAM")).toBe("(Family)");
    expect(medianLineFor("I-485", "131B")).toBe("(Asylum)");
    expect(medianLineFor("I-485", "131C")).toBe("(Refugee)");
    expect(medianLineFor("I-140", "136A-E21")).toBe("Immigrant Petition for Alien Workers");
    expect(medianLineFor("I-140", "136A-NIW")).toBe("Immigrant Petition for Alien Workers");
    expect(medianLineFor("I-765", "147-C9")).toBe("(Adjustment Of Status)");
    expect(medianLineFor("N-400", "160A")).toBe("Application for Naturalization");
    expect(medianLineFor("I-130", "134A-IR")).toBe("(Immediate Relative)");
  });

  it("borrows no median for a category the quarterly report folds in with others", () => {
    // The report's "All Other" lines mix many categories, so none of them stands for one.
    expect(medianLineFor("I-485", "131T")).toBeNull();
    expect(medianLineFor("I-485", "131A-HRIFA")).toBeNull();
    expect(medianLineFor("I-765", "147-C11")).toBeNull();
    expect(medianLineFor("I-765", "147-OTH")).toBeNull();
    expect(medianLineFor("I-130", "134B-F41")).toBeNull();
    expect(medianLineFor("I-539", "153")).toBeNull();
    expect(medianLineFor("", "")).toBeNull();
  });
});

describe("pickMedian", () => {
  // USCIS's FY2026 Q3 report, the lines for two forms.
  const i485 = [
    { title: "Application to Register Permanent Residence or Adjust Status (Asylum)", medianMonths: 25.6 },
    { title: "Application to Register Permanent Residence or Adjust Status (Employment)", medianMonths: 6.0 },
    { title: "Application to Register Permanent Residence or Adjust Status (Family)", medianMonths: 7.0 },
    { title: "Application to Register Permanent Residence or Adjust Status (Other)", medianMonths: 21.0 },
  ];
  const n400 = [
    { title: "Application for Naturalization", medianMonths: 9.5 },
    { title: "Application for Naturalization (Military)", medianMonths: 2.6 },
  ];

  it("takes the one line the words name: a basis in brackets by the title's end, a whole title by itself", () => {
    expect(pickMedian(i485, "(Employment)")).toBe(6.0);
    expect(pickMedian(i485, "(Family)")).toBe(7.0);
    // The whole title, never the military line that starts with the same words.
    expect(pickMedian(n400, "Application for Naturalization")).toBe(9.5);
  });

  it("gives none when no line fits, when two do, or when USCIS printed no median for it", () => {
    expect(pickMedian(i485, "(Refugee)")).toBeNull();
    expect(pickMedian([...i485, { title: "Something else (Employment)", medianMonths: 3 }], "(Employment)")).toBeNull();
    expect(pickMedian([{ title: "Immigrant Petition for Alien Workers", medianMonths: null }], "Immigrant Petition for Alien Workers")).toBeNull();
    expect(pickMedian([{ title: "Immigrant Petition for Alien Workers", medianMonths: 0 }], "Immigrant Petition for Alien Workers")).toBeNull();
    expect(pickMedian(i485, null)).toBeNull();
    expect(pickMedian([], "(Employment)")).toBeNull();
  });
});

describe("postedInSentence", () => {
  it("sets USCIS's printed unit in lower case and leaves the figure alone", () => {
    expect(postedInSentence("9.5 Months")).toBe("9.5 months");
    expect(postedInSentence("1 Month")).toBe("1 month");
    expect(postedInSentence("3 Weeks")).toBe("3 weeks");
    // Already lower case, or a unit this doesn't know: as printed.
    expect(postedInSentence("42.5 months")).toBe("42.5 months");
    expect(postedInSentence("Monthsly 4")).toBe("Monthsly 4");
  });

  it("is null where USCIS printed nothing, so the caller says so in its own words", () => {
    expect(postedInSentence(null)).toBeNull();
    expect(postedInSentence(undefined)).toBeNull();
    expect(postedInSentence("  ")).toBeNull();
  });
});
