import { describe, expect, it } from "vitest";

import { CHECK_DAYS_KEPT, checkDays, forgetAsked, noteCheck, readAsked, rememberAsked, type KeyValueStore } from "@/lib/caseWatchMemory";

const CASE = "G-100-26030-604655";

function store(seed: Record<string, string> = {}): KeyValueStore & { items: Map<string, string> } {
  const items = new Map(Object.entries(seed));
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
}

/** A browser that refuses its storage on every call. */
const refusing: KeyValueStore = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("the day this browser asked for emails about a case", () => {
  it("is kept by case number and read back", () => {
    const s = store();

    rememberAsked(s, CASE, "2026-11-09");

    expect(readAsked(s, CASE)).toBe("2026-11-09");
    expect(readAsked(s, "G-100-26030-000000")).toBeNull();
  });

  it("can be forgotten, for someone who wants to ask again", () => {
    const s = store();
    rememberAsked(s, CASE, "2026-11-09");

    forgetAsked(s, CASE);

    expect(readAsked(s, CASE)).toBeNull();
  });

  it("reads anything that isn't a day as nothing", () => {
    expect(readAsked(store({ [`pt-watch:${CASE}`]: "yes" }), CASE)).toBeNull();
    const s = store();
    rememberAsked(s, CASE, "last week");
    expect(s.items.size).toBe(0);
  });

  it("never throws in a browser that refuses storage, or with none", () => {
    expect(readAsked(refusing, CASE)).toBeNull();
    expect(() => rememberAsked(refusing, CASE, "2026-11-09")).not.toThrow();
    expect(() => forgetAsked(refusing, CASE)).not.toThrow();
    expect(readAsked(null, CASE)).toBeNull();
  });
});

describe("the days this browser checked a case", () => {
  it("counts a first visit as one", () => {
    expect(noteCheck(store(), CASE, "2026-11-11")).toBe(1);
  });

  it("counts different days, and a second look on the same day once", () => {
    const s = store();

    expect(noteCheck(s, CASE, "2026-11-09")).toBe(1);
    expect(noteCheck(s, CASE, "2026-11-09")).toBe(1);
    expect(noteCheck(s, CASE, "2026-11-10")).toBe(2);
    expect(noteCheck(s, CASE, "2026-11-11")).toBe(3);
  });

  it("can be read without adding a day", () => {
    const s = store();
    noteCheck(s, CASE, "2026-11-09");
    noteCheck(s, CASE, "2026-11-10");

    expect(checkDays(s, CASE)).toBe(2);
    expect(checkDays(s, CASE)).toBe(2);
    expect(checkDays(null, CASE)).toBe(0);
  });

  it("keeps each case's days apart", () => {
    const s = store();
    noteCheck(s, CASE, "2026-11-09");
    noteCheck(s, CASE, "2026-11-10");

    expect(noteCheck(s, "G-100-26030-000000", "2026-11-11")).toBe(1);
  });

  it("starts again from a stored value it can't read", () => {
    expect(noteCheck(store({ [`pt-checks:${CASE}`]: "{not json" }), CASE, "2026-11-11")).toBe(1);
    expect(noteCheck(store({ [`pt-checks:${CASE}`]: JSON.stringify(["x", 3, "2026-11-10"]) }), CASE, "2026-11-11")).toBe(2);
  });

  it("keeps a bounded number of days, the newest ones", () => {
    const s = store();
    const start = Date.parse("2026-01-01T12:00:00Z");
    let n = 0;
    for (let i = 0; i < CHECK_DAYS_KEPT + 20; i++) n = noteCheck(s, CASE, new Date(start + i * 86_400_000).toISOString().slice(0, 10));

    expect(n).toBe(CHECK_DAYS_KEPT);
    const kept = JSON.parse(s.items.get(`pt-checks:${CASE}`)!) as string[];
    expect(kept[0]).toBe(new Date(start + 20 * 86_400_000).toISOString().slice(0, 10));
  });

  it("answers one, and never throws, where storage is refused or absent", () => {
    expect(noteCheck(refusing, CASE, "2026-11-11")).toBe(1);
    expect(noteCheck(null, CASE, "2026-11-11")).toBe(1);
    expect(noteCheck(store(), CASE, "today")).toBe(1);
  });
});
