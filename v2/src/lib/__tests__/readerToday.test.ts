import { describe, expect, it } from "vitest";

import { localDay, readerToday } from "@/lib/readerToday";

describe("readerToday", () => {
  it("is the reader's own calendar day, never UTC's: late evening stays today", () => {
    expect(readerToday(new Date(2026, 10, 25, 23, 30))).toBe("2026-11-25");
    expect(readerToday(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });

  it("pads the month and day", () => {
    expect(readerToday(new Date(2027, 2, 9, 12))).toBe("2027-03-09");
  });
});

describe("localDay", () => {
  it("names the calendar day a parsed date falls on, locally", () => {
    expect(localDay(new Date(2026, 6, 4, 22, 0))).toBe("2026-07-04");
  });
});
