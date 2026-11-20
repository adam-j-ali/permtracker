import { describe, expect, it } from "vitest";

import {
  migratedTimelineSwitch,
  onTimeline,
  timelineSwitchFor,
  timelineSwitchForEdit,
  timelineSwitchForNewCase,
  wasOnTimeline,
} from "./timelineShow";

const open = { caseStatus: "recruitment" };
const closed = { caseStatus: "closed" };

describe("the timeline's one switch per case", () => {
  it("follows the case while unset: on while open, off once closed; set, it holds", () => {
    expect(onTimeline(open)).toBe(true);
    expect(onTimeline(closed)).toBe(false);
    expect(onTimeline({ ...open, showOnTimeline: false })).toBe(false);
    expect(onTimeline({ ...closed, showOnTimeline: true })).toBe(true);
  });

  it("stores a new case's switch only when it was asked off", () => {
    expect(timelineSwitchForNewCase(undefined)).toBeUndefined();
    expect(timelineSwitchForNewCase(true)).toBeUndefined();
    expect(timelineSwitchForNewCase(false)).toBe(false);
  });

  it("reads the form's value sent back unchanged as no change, and a different one as the person's choice", () => {
    expect(timelineSwitchForEdit(open, true)).toBe("keep");
    expect(timelineSwitchForEdit(closed, false)).toBe("keep");
    expect(timelineSwitchForEdit(open, undefined)).toBe("keep");
    expect(timelineSwitchForEdit(open, false)).toBe(false);
    expect(timelineSwitchForEdit(closed, true)).toBe(true);
    expect(timelineSwitchForEdit({ ...open, showOnTimeline: false }, true)).toBe(true);
  });

  it("puts a case on or off with the smallest switch that does it", () => {
    expect(timelineSwitchFor(open, true)).toBeUndefined();
    expect(timelineSwitchFor(open, false)).toBe(false);
    expect(timelineSwitchFor(closed, true)).toBe(true);
    expect(timelineSwitchFor(closed, false)).toBeUndefined();
  });
});

describe("the migration from the old list", () => {
  const a = { _id: "a", ...open };
  const b = { _id: "b", ...open };
  const c = { _id: "c", ...closed };

  it("knows what the old reader showed: the list, or every open case, or with an empty list every case", () => {
    expect([a, b, c].map((x) => wasOnTimeline(x, ["a", "c"]))).toEqual([true, false, true]);
    expect([a, b, c].map((x) => wasOnTimeline(x, undefined))).toEqual([true, true, false]);
    expect([a, b, c].map((x) => wasOnTimeline(x, []))).toEqual([true, true, true]);
    expect(wasOnTimeline({ ...a, showOnTimeline: false }, ["a"])).toBe(false);
  });

  it("gives each case the switch that keeps it where it was shown", () => {
    for (const list of [["a", "c"], undefined, []] as const) {
      for (const x of [a, b, c, { ...a, showOnTimeline: false }, { ...c, showOnTimeline: true }]) {
        const after = { ...x, showOnTimeline: migratedTimelineSwitch(x, list) };
        expect(onTimeline(after)).toBe(wasOnTimeline(x, list));
      }
    }
    // A switch left on by the old form default, on a closed case nobody picked, is unset: it stays off the timeline.
    expect(migratedTimelineSwitch({ ...c, showOnTimeline: true }, undefined)).toBeUndefined();
  });
});
