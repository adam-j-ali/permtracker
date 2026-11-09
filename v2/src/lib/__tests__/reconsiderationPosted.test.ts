import { describe, expect, it } from "vitest";

import { furthestWatched, reconsiderationPosted } from "../reconsiderationPosted";

const reading = (permAsOf: string, month: string | null, other = true) => ({
  permAsOf,
  permQueues: [
    ...(other ? [{ queue: "Analyst Review", priorityDate: "2026-01" }] : []),
    ...(month === null ? [] : [{ queue: "Reconsideration Request to the CO", priorityDate: month }]),
  ],
});

describe("reconsiderationPosted", () => {
  // DOL's own readings, as kept: April from August 20 to September 22, May on October 5 and 21, gone on October 31.
  const kept = [
    reading("2026-10-31", null, false),
    reading("2026-10-21", "2026-05"),
    reading("2026-10-05", "2026-05"),
    reading("2026-09-22", "2026-04"),
    reading("2026-08-31", "2026-04"),
    reading("2026-08-20", "2026-04"),
  ];

  it("folds the readings to the runs DOL posted each month for, oldest first, whatever order they arrive in", () => {
    const got = reconsiderationPosted(kept);
    expect(got?.runs).toEqual([
      { month: "2026-04", from: "2026-08-20", to: "2026-09-22" },
      { month: "2026-05", from: "2026-10-05", to: "2026-10-21" },
    ]);
  });

  it("says how far behind its own date the newest posting was, in whole months", () => {
    expect(reconsiderationPosted(kept)?.last).toEqual({ month: "2026-05", asOf: "2026-10-21", monthsBehind: 5 });
    // Across a year's end.
    expect(reconsiderationPosted([reading("2027-02-10", "2026-11")])?.last.monthsBehind).toBe(3);
  });

  it("names the first reading on which the line was gone", () => {
    expect(reconsiderationPosted(kept)?.droppedAsOf).toBe("2026-10-31");
    expect(reconsiderationPosted([...kept, reading("2026-11-15", null, false)])?.droppedAsOf).toBe("2026-10-31");
  });

  it("says the line isn't gone while the newest reading has it, even after a reading that printed none", () => {
    expect(reconsiderationPosted(kept.slice(1))?.droppedAsOf).toBeNull();
    const back = reconsiderationPosted([...kept, reading("2026-11-20", "2026-06")]);
    expect(back?.droppedAsOf).toBeNull();
    expect(back?.last).toEqual({ month: "2026-06", asOf: "2026-11-20", monthsBehind: 5 });
  });

  it("is nothing when no reading ever carried the line, or carried a month it can't read", () => {
    expect(reconsiderationPosted([])).toBeNull();
    expect(reconsiderationPosted([reading("2026-10-31", null)])).toBeNull();
    expect(reconsiderationPosted([reading("2026-10-21", "May 2026")])).toBeNull();
    expect(reconsiderationPosted([reading("not a day", "2026-05")])).toBeNull();
  });
});

describe("furthestWatched", () => {
  const curve = [
    { days: 10, eligible: 640, left: 2 },
    { days: 30, eligible: 410, left: 6 },
    { days: 45, eligible: 120, left: 9 },
    { days: 60, eligible: 41, left: 9 },
  ];

  it("takes the furthest day enough requests have been watched for", () => {
    expect(furthestWatched(curve)).toEqual({ days: 45, eligible: 120, left: 9 });
    expect(furthestWatched(curve, 30)).toEqual({ days: 60, eligible: 41, left: 9 });
  });

  it("is nothing while no day has enough", () => {
    expect(furthestWatched(curve, 1000)).toBeNull();
    expect(furthestWatched([])).toBeNull();
  });
});
