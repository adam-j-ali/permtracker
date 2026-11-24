import { describe, expect, it } from "vitest";
import { statusDates } from "../statusDates";

describe("statusDates", () => {
  const open = { isFinal: false, statusSince: "2026-11-16T09:00:00Z", sinceFirstSeen: false, lastCheckedAt: "2026-11-23" };

  it("gives an open request's status day and its newest check, as Eastern days", () => {
    expect(statusDates(open)).toEqual({ since: "2026-11-16", sinceOrEarlier: false, checked: "2026-11-23" });
  });

  it("reads an evening UTC stamp as its Eastern day", () => {
    expect(statusDates({ ...open, statusSince: "2026-11-17T02:30:00Z" }).since).toBe("2026-11-16");
  });

  it("marks a status unchanged since the case was first seen as that day or earlier", () => {
    expect(statusDates({ ...open, sinceFirstSeen: true }).sinceOrEarlier).toBe(true);
  });

  it("gives a decided request no check: it isn't asked again", () => {
    expect(statusDates({ ...open, isFinal: true }).checked).toBeNull();
  });

  it("gives nothing for missing stamps", () => {
    expect(statusDates({ isFinal: false, statusSince: null, sinceFirstSeen: false, lastCheckedAt: null })).toEqual({
      since: null,
      sinceOrEarlier: false,
      checked: null,
    });
  });
});
