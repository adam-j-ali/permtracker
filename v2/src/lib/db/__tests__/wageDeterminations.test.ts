import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The read behind /perm-updates' wage line. What must hold: it asks for the day's whole week by DOL's day (7 AM
 * Eastern to 7 AM), on the index the board reads the same table by, keeps the count to the ETA-9141 requests, reads
 * libSQL's string integers as numbers, and throws on a failed read rather than answering 0.
 */

const asked: { sql: string; args: unknown[] }[] = [];
let answer: Record<string, unknown>[] | Error = [];

vi.mock("../client", () => ({
  rows: async (sql: string, args: unknown[] = []) => {
    asked.push({ sql, args });
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));

import { getWageDeterminations } from "../wageDeterminations";

/** An Eastern wall-clock time in November 2026 (UTC-5) as epoch ms. */
const est = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00-05:00`);

beforeEach(() => {
  asked.length = 0;
  answer = [];
});

describe("getWageDeterminations", () => {
  it("reads the week from Monday's 7 AM to 7 AM after the day, on the board's index, P-100 and P-200 to P-203 only", async () => {
    // Act
    await getWageDeterminations("2026-11-22");

    // Assert
    expect(asked).toHaveLength(1);
    const { sql, args } = asked[0]!;
    expect(args).toEqual([est("2026-11-16", "07:00"), est("2026-11-23", "07:00")]);
    expect(sql).toContain("FROM pwd_case_events e INDEXED BY pwd_events_recent");
    expect(sql).toContain("e.case_number < 'P-400-'");
    expect(sql).toContain("GROUP BY e.changed_at, e.to_status");
  });

  it("counts libSQL's string integers as numbers", async () => {
    answer = [
      { t: String(est("2026-11-23", "05:40")), status: "DETERMINATION ISSUED", n: "185", own: "185" },
      { t: String(est("2026-11-20", "05:40")), status: "DETERMINATION ISSUED", n: "800", own: "800" },
    ];
    expect(await getWageDeterminations("2026-11-22")).toEqual({ day: "2026-11-22", onDay: 185, weekFrom: "2026-11-16", week: 985 });
  });

  it("throws when the read fails, so the page never prints a 0 it didn't count", async () => {
    answer = new Error("SQLITE_BUSY");
    await expect(getWageDeterminations("2026-11-22")).rejects.toThrow("SQLITE_BUSY");
  });

  it("asks nothing for a day that isn't one", async () => {
    expect(await getWageDeterminations("2026-02-30")).toBeNull();
    expect(asked).toHaveLength(0);
  });
});
