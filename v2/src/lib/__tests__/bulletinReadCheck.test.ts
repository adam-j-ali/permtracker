import { describe, expect, it } from "vitest";

import { waitingCheck } from "../bulletinReadCheck";

/** Our daily read of State's bulletin page, as the visa bulletin page may report it (Nov 19 2026). */
const at = (iso: string) => Date.parse(iso);
const check = (iso: string, note = "loaded State bulletin page, December 2026 not out yet (Coming Soon)") => ({
  checkedAt: at(iso),
  note,
});

describe("whether the page may say the next bulletin isn't out yet", () => {
  it("says so after a read of State's page this morning, while the newest bulletin held is the one before", () => {
    // 11:37 AM EST on Nov 19 is 16:37 UTC; the page renders that afternoon.
    expect(waitingCheck("2026-12", check("2026-11-19T16:37:00Z"), at("2026-11-19T20:00:00Z"))).toEqual({
      checkedAt: at("2026-11-19T16:37:00Z"),
    });
  });

  it("says nothing when the last check didn't read the page: a gate stop or a failed read", () => {
    const now = at("2026-11-19T20:00:00Z");
    expect(waitingCheck("2026-12", check("2026-11-19T16:37:00Z", "checked, nothing due"), now)).toBeNull();
    expect(waitingCheck("2026-12", check("2026-11-19T16:37:00Z", "could not read travel.state.gov: Chrome not connected"), now)).toBeNull();
  });

  it("says nothing from a read more than 36 hours old", () => {
    expect(waitingCheck("2026-12", check("2026-11-17T16:37:00Z"), at("2026-11-19T20:00:00Z"))).toBeNull();
  });

  it("says nothing from a read made before the month the bulletin is due in", () => {
    // A check on Oct 31 says nothing about the December bulletin, which comes in November.
    expect(waitingCheck("2026-12", check("2026-10-31T23:00:00Z"), at("2026-11-01T12:00:00Z"))).toBeNull();
  });

  it("says nothing without a check at all", () => {
    expect(waitingCheck("2026-12", null, at("2026-11-19T20:00:00Z"))).toBeNull();
  });
});
