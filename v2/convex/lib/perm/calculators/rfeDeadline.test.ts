import { describe, expect, it } from "vitest";

import { NOID_MAX_RESPONSE_DAYS, RFE_MAX_RESPONSE_DAYS, USCIS_MAIL_DAYS, rfeResponseDeadline } from "./rfeDeadline";

/**
 * The rule as the USCIS Policy Manual states it (1 USCIS-PM E.6(F), current as of Nov 20 2026), each part from its
 * regulation: the period printed on the notice, at most 12 weeks (84 days) for an RFE and 30 days for a NOID
 * (8 CFR 103.2(b)(8)(iv)); 3 days more when USCIS mails it (8 CFR 103.8(b)), "a maximum of 87 days"; and a last day on
 * a Saturday, Sunday or federal holiday runs to the next day that is none of them (8 CFR 1.2, "Day").
 */

describe("the USCIS RFE response deadline", () => {
  it("adds the period and the 3 mailing days to a mailed notice", () => {
    // Arrange: Wednesday, January 7, 2026 + 87 days = Saturday, April 4, 2026.
    const input = { noticeDate: "2026-01-07", responseDays: 84, mailed: true };

    // Act
    const r = rfeResponseDeadline(input);

    // Assert
    expect(r.counted).toBe("2026-04-04");
    // The 87th day is a Saturday, so the period runs to Monday.
    expect(r.due).toBe("2026-04-06");
    expect(r.movedBecause).toBe("Saturday");
    expect(r.mailDays).toBe(3);
  });

  it("adds no mailing days to a notice posted to the online account", () => {
    const r = rfeResponseDeadline({ noticeDate: "2026-01-07", responseDays: 84, mailed: false });
    expect(r.counted).toBe("2026-04-01");
    expect(r.due).toBe("2026-04-01");
    expect(r.movedBecause).toBeNull();
    expect(r.mailDays).toBe(0);
  });

  it("gives a 30-day NOID mailed the Policy Manual's 33 days", () => {
    // Monday, March 2, 2026 + 33 = Saturday, April 4: on to Monday, April 6.
    const r = rfeResponseDeadline({ noticeDate: "2026-03-02", responseDays: NOID_MAX_RESPONSE_DAYS, mailed: true });
    expect(r.counted).toBe("2026-04-04");
    expect(r.due).toBe("2026-04-06");
  });

  it("runs past a federal holiday, and past the weekend that follows it", () => {
    // Friday, December 25, 2026 is Christmas; the next day neither weekend nor holiday is Monday, December 28.
    const r = rfeResponseDeadline({ noticeDate: "2026-11-25", responseDays: 30, mailed: false });
    expect(r.counted).toBe("2026-12-25");
    expect(r.due).toBe("2026-12-28");
    expect(r.movedBecause).toBe("Christmas Day");
  });

  it("names Sunday when the count ends on one", () => {
    // Thursday, October 1, 2026 + 87 = Sunday, December 27, 2026.
    const r = rfeResponseDeadline({ noticeDate: "2026-10-01", responseDays: 84, mailed: true });
    expect(r.counted).toBe("2026-12-27");
    expect(r.due).toBe("2026-12-28");
    expect(r.movedBecause).toBe("Sunday");
  });

  it("holds the regulation's ceilings", () => {
    expect(RFE_MAX_RESPONSE_DAYS).toBe(84);
    expect(NOID_MAX_RESPONSE_DAYS).toBe(30);
    expect(USCIS_MAIL_DAYS).toBe(3);
    expect(() => rfeResponseDeadline({ noticeDate: "2026-01-07", responseDays: 85, mailed: true })).toThrow(/responseDays/);
    expect(() => rfeResponseDeadline({ noticeDate: "2026-01-07", responseDays: 0, mailed: true })).toThrow(/responseDays/);
    expect(() => rfeResponseDeadline({ noticeDate: "2026-01-07", responseDays: 12.5, mailed: true })).toThrow(/responseDays/);
  });

  it("refuses a date that isn't one", () => {
    expect(() => rfeResponseDeadline({ noticeDate: "2026-02-30", responseDays: 84, mailed: true })).toThrow(/noticeDate/);
  });
});
