import { describe, expect, it } from "vitest";

import { checkedPhrase, checkTimes, newestIsFullRead } from "@/lib/checkTimes";

// Nov 20 2026 in Eastern (EST, UTC-5).
const at = (hhmm: string, day = "2026-11-20") => Date.parse(`${day}T${hhmm}:00-05:00`);

describe("checkTimes", () => {
  it("takes the newer of the daytime check and the complete read", () => {
    // Arrange
    const latest = at("12:45");
    const full = at("10:55");

    // Act
    const t = checkTimes(latest, full);

    // Assert
    expect(t).toEqual({ newest: latest, full });
    expect(newestIsFullRead(t!)).toBe(false);
  });

  it("treats the complete read as the newest check when its record is the later one", () => {
    const t = checkTimes(at("10:52"), at("10:55"));

    expect(t?.newest).toBe(at("10:55"));
    expect(newestIsFullRead(t!)).toBe(true);
  });

  it("works from either time alone, and is null with neither", () => {
    expect(checkTimes(at("12:45"), null)).toEqual({ newest: at("12:45"), full: null });
    expect(checkTimes(null, at("10:55"))).toEqual({ newest: at("10:55"), full: at("10:55") });
    expect(checkTimes(null, undefined)).toBeNull();
    expect(checkTimes(Number.NaN, null)).toBeNull();
  });
});

describe("checkedPhrase", () => {
  it("prints the newest check, with the complete read's time beside it the same day", () => {
    const t = checkTimes(at("12:45"), at("10:55"))!;

    expect(checkedPhrase(t)).toBe("checked 12:45 PM ET, Nov 20 (every waiting case read in full by 10:55 AM ET)");
  });

  it("names the complete read's day when it was an earlier day", () => {
    const t = checkTimes(at("07:15"), at("20:31", "2026-11-19"))!;

    expect(checkedPhrase(t)).toBe("checked 7:15 AM ET, Nov 20 (every waiting case read in full by 8:31 PM ET, Nov 19)");
  });

  it("prints one time when the newest check was the complete read, or when no complete read is recent", () => {
    expect(checkedPhrase(checkTimes(at("10:52"), at("10:55"))!)).toBe("checked 10:55 AM ET, Nov 20");
    expect(checkedPhrase(checkTimes(at("12:45"), null)!)).toBe("checked 12:45 PM ET, Nov 20");
  });
});
