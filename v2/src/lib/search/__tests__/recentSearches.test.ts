import { afterEach, describe, expect, it, vi } from "vitest";

import type { KeyValueStore } from "@/lib/caseWatchMemory";
import {
  RECENT_LABEL_MAX,
  RECENT_SEARCHES_KEPT,
  RECENT_SEARCHES_KEY,
  REFINE_WITHIN_MS,
  clearRecentSearches,
  hrefWithSearch,
  parseRecentSearches,
  publicSearches,
  readRecentSearches,
  recentSearchLabel,
  recordSearch,
  safeSearchHref,
  subscribeRecentSearches,
} from "@/lib/search/recentSearches";

function store(seed: Record<string, string> = {}): KeyValueStore & { items: Map<string, string> } {
  const items = new Map(Object.entries(seed));
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
}

/** A browser that refuses its storage on every call: private mode, blocked site data, a full quota. */
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

const T0 = Date.UTC(2026, 10, 23, 17, 0, 0);
const HOUR = 60 * 60 * 1000;

describe("what a recent search keeps of what was typed", () => {
  it("keeps a case number in its own shape, however it was typed", () => {
    expect(recentSearchLabel("  g-100-26125-868956 ")).toBe("G-100-26125-868956");
    expect(recentSearchLabel("A-23043-00641")).toBe("A-23043-00641");
  });

  it("keeps a name with its spaces tidied, and cuts a long one", () => {
    expect(recentSearchLabel("  Acme   Robotics  Inc ")).toBe("Acme Robotics Inc");
    expect(recentSearchLabel("x".repeat(500))).toHaveLength(RECENT_LABEL_MAX);
  });

  it("keeps nothing too short to be a search", () => {
    expect(recentSearchLabel("")).toBeNull();
    expect(recentSearchLabel("   ")).toBeNull();
    expect(recentSearchLabel("a")).toBeNull();
  });

  it("never keeps a USCIS receipt number, whole, masked or overlong", () => {
    expect(recentSearchLabel("EAC3590123456")).toBeNull();
    expect(recentSearchLabel("ioe 0000000000")).toBeNull();
    expect(recentSearchLabel("EAC*590123456")).toBeNull();
    expect(recentSearchLabel("EAC21901234567890")).toBeNull();
    // Short groups: no run of digits, nothing shaped like a phone number, still a receipt.
    expect(recentSearchLabel("EAC-36-90-12-34-56")).toBeNull();
  });

  it("never keeps an email address, a phone number or an SSN typed into a box", () => {
    expect(recentSearchLabel("jane.doe@example.com")).toBeNull();
    expect(recentSearchLabel("call 4155550123")).toBeNull();
    expect(recentSearchLabel("415-555-0123")).toBeNull();
    expect(recentSearchLabel("(415) 555-0123")).toBeNull();
    expect(recentSearchLabel("123-45-6789")).toBeNull();
  });

  it("never keeps a case number typed wrong, which would only fail again", () => {
    expect(recentSearchLabel("G-100-2612-868956")).toBeNull();
    expect(recentSearchLabel("A-2304-00641")).toBeNull();
  });

  it("keeps a job code, a month, a form or visa name and a name with a number in it", () => {
    expect(recentSearchLabel("15-1252.00")).toBe("15-1252.00");
    expect(recentSearchLabel("2026-03")).toBe("2026-03");
    expect(recentSearchLabel("3M Company")).toBe("3M Company");
    expect(recentSearchLabel("H-1B")).toBe("H-1B");
    expect(recentSearchLabel("I-140 approvals")).toBe("I-140 approvals");
  });
});

describe("where a recent search may lead", () => {
  it("is a page on this site", () => {
    expect(safeSearchHref("/perm-employers?q=acme#all")).toBe("/perm-employers?q=acme#all");
    expect(safeSearchHref("/perm-case-status?case=G-100-26125-868956")).toBe("/perm-case-status?case=G-100-26125-868956");
  });

  it("is never another site, a script or a malformed address", () => {
    for (const bad of ["//evil.example/x", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "perm", "", "/a b", `/${"x".repeat(2000)}`]) {
      expect(safeSearchHref(bad), bad).toBeNull();
    }
  });

  it("is built from the page it was made on, with the box's own field set and the page count dropped", () => {
    expect(hrefWithSearch("https://permtracker.app/policy-changes?kind=rule&page=3#list", "q", "prevailing wage")).toBe(
      "/policy-changes?kind=rule&q=prevailing+wage#list",
    );
    expect(hrefWithSearch("https://permtracker.app/cases", "search", "Acme")).toBe("/cases?search=Acme");
  });
});

describe("the list of recent searches", () => {
  it("keeps the newest first", () => {
    const s = store();
    recordSearch({ label: "Acme", href: "/case-search?q=Acme" }, s, T0);
    recordSearch({ label: "Globex", href: "/case-search?q=Globex" }, s, T0 + HOUR);

    expect(readRecentSearches(s).map((r) => r.label)).toEqual(["Globex", "Acme"]);
  });

  it(`keeps at most ${RECENT_SEARCHES_KEPT}, dropping the oldest`, () => {
    const s = store();
    for (let i = 0; i < RECENT_SEARCHES_KEPT + 3; i++) {
      recordSearch({ label: `Employer ${i}`, href: `/case-search?q=e${i}` }, s, T0 + i * HOUR);
    }
    const kept = readRecentSearches(s);

    expect(kept).toHaveLength(RECENT_SEARCHES_KEPT);
    expect(kept[0]!.label).toBe(`Employer ${RECENT_SEARCHES_KEPT + 2}`);
    expect(kept.some((r) => r.label === "Employer 0")).toBe(false);
    // What's stored, not only what's read: the browser holds no more than the list shows.
    expect(JSON.parse(s.items.get(RECENT_SEARCHES_KEY)!)).toHaveLength(RECENT_SEARCHES_KEPT);
  });

  it("holds a search once: the same words or the same page again move it to the top", () => {
    const s = store();
    recordSearch({ label: "Acme", href: "/case-search?q=Acme" }, s, T0);
    recordSearch({ label: "Globex", href: "/case-search?q=Globex" }, s, T0 + HOUR);
    recordSearch({ label: "ACME", href: "/perm-employers?q=ACME#all" }, s, T0 + 2 * HOUR);
    recordSearch({ label: "Globex Corp", href: "/case-search?q=Globex" }, s, T0 + 3 * HOUR);

    const expected = [
      { label: "Globex Corp", href: "/case-search?q=Globex", at: T0 + 3 * HOUR },
      { label: "ACME", href: "/perm-employers?q=ACME#all", at: T0 + 2 * HOUR },
    ];
    expect(readRecentSearches(s)).toEqual(expected);
    expect(JSON.parse(s.items.get(RECENT_SEARCHES_KEY)!)).toEqual(expected);
  });

  it("lets a search typed further on the same page replace the one it grew from", () => {
    const s = store();
    recordSearch({ label: "acm", href: "/debarments?q=acm" }, s, T0);
    recordSearch({ label: "acme rob", href: "/debarments?q=acme+rob" }, s, T0 + REFINE_WITHIN_MS - 1);

    expect(readRecentSearches(s).map((r) => r.label)).toEqual(["acme rob"]);
  });

  it("keeps both when the longer one came later, on another page, or was a different search", () => {
    const s = store();
    recordSearch({ label: "acm", href: "/debarments?q=acm" }, s, T0);
    recordSearch({ label: "acme", href: "/debarments?q=acme" }, s, T0 + REFINE_WITHIN_MS + 1);
    recordSearch({ label: "acme co", href: "/case-search?q=acme+co" }, s, T0 + REFINE_WITHIN_MS + 2);
    recordSearch({ label: "ac", href: "/case-search?q=ac" }, s, T0 + REFINE_WITHIN_MS + 3);

    expect(readRecentSearches(s).map((r) => r.label)).toEqual(["ac", "acme co", "acme", "acm"]);
  });

  it("refuses what it shouldn't keep, and says so", () => {
    const s = store();
    expect(recordSearch({ label: "EAC3590123456", href: "/uscis-case-status?receipt=EAC3590123456" }, s, T0)).toBeNull();
    expect(recordSearch({ label: "Acme", href: "https://evil.example/?q=Acme" }, s, T0)).toBeNull();
    expect(s.items.size).toBe(0);
    expect(recordSearch({ label: "g10026125868956", href: "/perm-case-status?case=G-100-26125-868956" }, s, T0)).toEqual({
      label: "G-100-26125-868956",
      href: "/perm-case-status?case=G-100-26125-868956",
      at: T0,
    });
  });

  it("reads past anything malformed in storage, and drops entries it would refuse today", () => {
    const raw = JSON.stringify([
      { label: "Acme", href: "/case-search?q=Acme", at: T0 },
      { label: "EAC3590123456", href: "/uscis-case-status?receipt=EAC3590123456", at: T0 + 1 },
      { label: "Bad", href: "//evil.example", at: T0 + 2 },
      { label: "No time", href: "/x" },
      "a string",
      null,
      { label: "Globex", href: "/case-search?q=Globex", at: T0 + 3 },
      { label: "globex", href: "/case-search?q=globex", at: T0 - 5 },
    ]);

    expect(parseRecentSearches(raw).map((r) => r.label)).toEqual(["Globex", "Acme"]);
    expect(parseRecentSearches("{not json")).toEqual([]);
    expect(parseRecentSearches('{"label":"Acme"}')).toEqual([]);
    expect(parseRecentSearches(null)).toEqual([]);
  });

  it("is cleared at once", () => {
    const s = store();
    recordSearch({ label: "Acme", href: "/case-search?q=Acme" }, s, T0);
    clearRecentSearches(s);

    expect(readRecentSearches(s)).toEqual([]);
    expect(s.items.has(RECENT_SEARCHES_KEY)).toBe(false);
  });

  it("works on, empty, where the browser refuses storage or it's full", () => {
    expect(readRecentSearches(refusing)).toEqual([]);
    expect(() => recordSearch({ label: "Acme", href: "/case-search?q=Acme" }, refusing, T0)).not.toThrow();
    expect(() => clearRecentSearches(refusing)).not.toThrow();
    expect(readRecentSearches(null)).toEqual([]);
    expect(recordSearch({ label: "Acme", href: "/case-search?q=Acme" }, null, T0)).toBeNull();
  });

  it("shows a public box no page from the signed-in app", () => {
    const list = [
      { label: "Acme", href: "/cases?search=Acme", at: T0 + 2 },
      { label: "Globex", href: "/case-search?q=Globex", at: T0 + 1 },
      { label: "Initech", href: "/cases/k57abc", at: T0 },
    ];

    expect(publicSearches(list).map((r) => r.label)).toEqual(["Globex"]);
  });
});

describe("telling the page, and other tabs, that the list changed", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("tells this page when a search is kept or the list is cleared", () => {
    const onChange = vi.fn();
    const stop = subscribeRecentSearches(onChange);

    recordSearch({ label: "Acme", href: "/case-search?q=Acme" }, window.localStorage, T0);
    clearRecentSearches(window.localStorage);
    stop();
    recordSearch({ label: "Globex", href: "/case-search?q=Globex" }, window.localStorage, T0);

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("hears another tab change the list, and only the list", () => {
    const onChange = vi.fn();
    const stop = subscribeRecentSearches(onChange);

    window.dispatchEvent(new StorageEvent("storage", { key: RECENT_SEARCHES_KEY }));
    window.dispatchEvent(new StorageEvent("storage", { key: "pt-watch:G-100-26125-868956" }));
    // Another tab clearing the site's whole storage arrives with no key.
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key: RECENT_SEARCHES_KEY }));

    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
