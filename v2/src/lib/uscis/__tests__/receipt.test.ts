import { describe, expect, it } from "vitest";

import {
  describeTypedReceipt,
  RECEIPT_PREFIXES,
  RECEIPT_SHAPE_MESSAGE,
  decodeReceipt,
  looksLikeReceipt,
  normaliseReceipt,
  readPartialReceipt,
} from "../receipt";

/**
 * The receipt parser is the shape gate in front of a federal endpoint, so it
 * is pinned against the two regexes USCIS publishes rather than against
 * whatever this file happened to accept on the day it was written.
 */
describe("normaliseReceipt", () => {
  it("accepts USCIS's documented shape, upper-cased, separators stripped", () => {
    expect(normaliseReceipt("EAC3590123456")).toBe("EAC3590123456");
    expect(normaliseReceipt(" eac-35-901-23456 ")).toBe("EAC3590123456");
    expect(normaliseReceipt("wac 35 901 23456")).toBe("WAC3590123456");
  });

  it("accepts USCIS's masked form, three letters then * and nine digits", () => {
    expect(normaliseReceipt("EAC*590123456")).toBe("EAC*590123456");
  });

  it("refuses everything that USCIS's 422 would refuse", () => {
    for (const bad of [
      "",
      "EAC219012345", // nine digits
      "EAC21901234567", // eleven
      "EA2190123456", // two letters
      "EACX190123456", // letter in the digits
      "G-100-26125-868956", // a DOL number
      "P-100-26240-200135",
      "Microsoft",
      "EAC**90123456",
    ]) {
      expect(normaliseReceipt(bad), bad).toBeNull();
    }
  });

  it("puts the length cap before any work (a 100k string returns fast)", () => {
    const t0 = performance.now();
    expect(normaliseReceipt("E".repeat(100_000))).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("decodeReceipt", () => {
  it("names the office for every glossary prefix", () => {
    const d = decodeReceipt("EAC3590123456");
    expect(d).not.toBeNull();
    expect(d!.prefix).toBe("EAC");
    expect(d!.office?.name).toBe("Vermont Service Center");
    expect(d!.office?.source).toBe("glossary");
    expect(d!.masked).toBe(false);
  });

  it("reads a paper-center number as year, day and sequence when the day can be one", () => {
    expect(decodeReceipt("LIN2612345678")!.digits).toEqual({ series: "day", fiscalYear: 2026, day: 123, sequence: "45678" });
    expect(decodeReceipt("SRC2636650001")!.digits).toEqual({ series: "day", fiscalYear: 2026, day: 366, sequence: "50001" });
  });

  it("reads a 9 after the year as the lockbox series, a counter for the year, never a day 9xx", () => {
    // Nov 22 2026: the page printed "Day 901" for EAC3590123456; no fiscal year has a 901st day.
    expect(decodeReceipt("EAC3590123456")!.digits).toEqual({ series: "lockbox", fiscalYear: 2035, counter: 123456 });
    expect(decodeReceipt("MSC3690000001")!.digits).toEqual({ series: "lockbox", fiscalYear: 2036, counter: 1 });
  });

  it("gives an online (IOE) number no year or day: its digits are one running count", () => {
    expect(decodeReceipt("IOE0939123456")!.digits).toEqual({ series: "online" });
    expect(decodeReceipt("ioe 9812345678")!.digits).toEqual({ series: "online" });
  });

  it("guesses no year for digits that fit neither reading", () => {
    expect(decodeReceipt("WAC2640012345")!.digits).toEqual({ series: "unread" });
    expect(decodeReceipt("LIN2600012345")!.digits).toEqual({ series: "unread" });
  });

  it("keeps an unknown prefix rather than refusing it, because USCIS's regex accepts any three letters", () => {
    const d = decodeReceipt("ZZZ3590123456");
    expect(d).not.toBeNull();
    expect(d!.office).toBeNull();
    expect(d!.digits.series).toBe("lockbox");
  });

  it("gives a masked receipt nothing to read, IOE included", () => {
    expect(decodeReceipt("SRC*590123456")!.masked).toBe(true);
    expect(decodeReceipt("SRC*590123456")!.digits).toEqual({ series: "masked" });
    expect(decodeReceipt("IOE*093912345")!.digits).toEqual({ series: "masked" });
  });

  it("reads 90-99 as the 1990s and everything else as 2000s", () => {
    const year = (r: string) => {
      const d = decodeReceipt(r)!.digits;
      return d.series === "day" || d.series === "lockbox" ? d.fiscalYear : null;
    };
    expect(year("LIN9990000000")).toBe(1999);
    expect(year("LIN0012345678")).toBe(2000);
    expect(year("LIN2612345678")).toBe(2026);
  });

  it("lists the seven prefixes USCIS's glossary names, sourced to the glossary", () => {
    for (const p of ["EAC", "WAC", "LIN", "SRC", "NBC", "MSC", "IOE"]) {
      expect(RECEIPT_PREFIXES[p]?.source, p).toBe("glossary");
    }
    // YSC is real (Potomac) but not in the glossary's list; it must say so.
    expect(RECEIPT_PREFIXES.YSC?.source).toBe("notices");
  });
});

describe("looksLikeReceipt", () => {
  it("catches a half-typed receipt so the DOL page can point at the right one", () => {
    expect(looksLikeReceipt("EAC2190")).toBe(true);
    expect(looksLikeReceipt("ioe0000000000")).toBe(true);
    expect(looksLikeReceipt("EAC*1234")).toBe(true);
  });

  it("does not catch a DOL number, an employer name or nothing", () => {
    expect(looksLikeReceipt("G-100-26125-868956")).toBe(false);
    expect(looksLikeReceipt("A-23043-00641")).toBe(false);
    expect(looksLikeReceipt("Microsoft")).toBe(false);
    expect(looksLikeReceipt("")).toBe(false);
  });
});

describe("the shape message", () => {
  it("names the shape and where to find it, in one sentence pair", () => {
    expect(RECEIPT_SHAPE_MESSAGE).toMatch(/three letters and ten digits/);
    expect(RECEIPT_SHAPE_MESSAGE).toMatch(/I-797/);
  });
});

describe("readPartialReceipt: a receipt read as it's typed (RT1, Nov 25 2026)", () => {
  it("names the office from the first three letters, then counts down", () => {
    const r = readPartialReceipt("lin");
    expect(r.prefix).toBe("LIN");
    expect(r.office?.name).toBe("Nebraska Service Center");
    expect(r.remaining).toBe(10);
    expect(r.fiscalYear).toBeNull();
    expect(r.problem).toBeNull();
  });

  it("adds the fiscal year at five characters and the series at six, and the day at eight", () => {
    expect(readPartialReceipt("LIN26").fiscalYear).toBe(2026);
    expect(readPartialReceipt("LIN26").series).toBeNull();
    expect(readPartialReceipt("EAC219").series).toBe("lockbox");
    expect(readPartialReceipt("LIN260").series).toBe("day");
    const d = readPartialReceipt("LIN26042");
    expect(d.series).toBe("day");
    expect(d.day).toBe(42);
    expect(d.remaining).toBe(5);
  });

  it("reads an online number's series at once and never a year", () => {
    const r = readPartialReceipt("IOE09");
    expect(r.series).toBe("online");
    expect(r.fiscalYear).toBeNull();
  });

  it("decodes in full at thirteen characters, the same way decodeReceipt does", () => {
    const r = readPartialReceipt("lin-2604-214850");
    expect(r.remaining).toBe(0);
    expect(r.full).toEqual(decodeReceipt("LIN2604214850"));
  });

  it("names the first character that can't belong, by its position", () => {
    expect(readPartialReceipt("LI1").problem).toEqual({ position: 3, expected: "letter", got: "1" });
    expect(readPartialReceipt("LIN26A").problem).toEqual({ position: 6, expected: "digit", got: "A" });
    expect(readPartialReceipt("LIN26042148500").problem).toEqual({ position: 14, expected: "end", got: "0" });
  });

  it("offers the one-character fix for the usual typos, only when it makes a clean number", () => {
    expect(readPartialReceipt("LIN26O4214850").suggestion).toBe("LIN2604214850"); // O for zero
    expect(readPartialReceipt("LIN26042I4850").suggestion).toBe("LIN2604214850"); // I for one
    expect(readPartialReceipt("LIN26042l4850").suggestion).toBe("LIN2604214850"); // l for one
    expect(readPartialReceipt("L1N2604214850").suggestion).toBe("LIN2604214850"); // 1 for I in the letters
    expect(readPartialReceipt("I0E0000000000").suggestion).toBe("IOE0000000000"); // 0 for O in the letters
    expect(readPartialReceipt("LIN2604214850").suggestion).toBeNull();
    expect(readPartialReceipt("LIN26XX214850").suggestion).toBeNull(); // two wrong characters: no guess
  });

  it("recognises an A-number, which is a different number", () => {
    expect(readPartialReceipt("A123456789").otherKind).toBe("a-number");
    expect(readPartialReceipt("A-123-456-789").otherKind).toBe("a-number");
    expect(readPartialReceipt("A12345678").otherKind).toBe("a-number");
    expect(readPartialReceipt("LIN2604214850").otherKind).toBeNull();
  });

  it("says a three-letter start USCIS doesn't list is unknown, without refusing it", () => {
    const r = readPartialReceipt("XYZ2604214850");
    expect(r.office).toBeNull();
    expect(r.unknownPrefix).toBe(true);
    expect(r.full?.prefix).toBe("XYZ");
  });

  it("reads nothing from an empty box", () => {
    const r = readPartialReceipt("  ");
    expect(r.typed).toBe("");
    expect(r.remaining).toBe(13);
    expect(r.problem).toBeNull();
  });
});

describe("the box and the results page read a pasted receipt the same way (review, Nov 25 2026)", () => {
  it.each(["EAC.219.001.2345", "EAC\u20132190012345", "EAC2190012345.", " eac-219-001-2345 "])(
    "normalises %s, which the box already reads as a full number",
    (pasted) => {
      expect(readPartialReceipt(pasted).full).not.toBeNull();
      expect(normaliseReceipt(pasted)).toBe("EAC2190012345");
      expect(looksLikeReceipt(pasted)).toBe(true);
    },
  );
});

describe("describeTypedReceipt: one reading for every box a receipt is typed in (Nov 25 2026)", () => {
  it("says nothing for an empty box", () => {
    expect(describeTypedReceipt("")).toBeNull();
    expect(describeTypedReceipt("   ")).toBeNull();
  });

  it("names the office from three letters and counts what's left", () => {
    expect(describeTypedReceipt("lin")).toEqual({ tone: "info", text: "Nebraska Service Center. 10 more digits." });
  });

  it("adds the year and the series as they arrive, and stops counting once it's whole", () => {
    expect(describeTypedReceipt("IOE09")).toEqual({ tone: "info", text: "USCIS online filing (ELIS), filed online. 8 more digits." });
    expect(describeTypedReceipt("EAC2112312345")?.text).toBe("Vermont Service Center, fiscal year 2021. Look it up for the rest.");
    expect(describeTypedReceipt("EAC2190012345")?.text).toBe("Vermont Service Center, fiscal year 2021, a lockbox number. Look it up for the rest.");
  });

  it("names the first character that can't belong, by its position", () => {
    expect(describeTypedReceipt("LIN2X")).toEqual({ tone: "warn", text: "Character 5 should be a digit." });
    expect(describeTypedReceipt("EAC21900123456")).toEqual({ tone: "warn", text: "That's 14 characters. A receipt number has 13." });
  });

  it("tells an A-number apart, dashes or not", () => {
    for (const a of ["A123456789", "A-123-456-789"]) {
      expect(describeTypedReceipt(a)?.tone, a).toBe("warn");
      expect(describeTypedReceipt(a)?.text, a).toMatch(/A-number/);
    }
  });
});
