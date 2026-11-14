/**
 * The employers page states facts about how the site works. Each is held here to the code it describes, so a
 * timer that moves or a box that's renamed fails this before the page says something untrue.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EVERY_CASE_LABEL, followPromise } from "../employerCaseMoves";
import { EMPLOYER_FAQS, EMPLOYER_STEPS } from "../forEmployers";
import { getStatusMeaning } from "../permStatus";
import { CASE_CHECKS } from "../sweepSchedule";

const answer = (start: string) => EMPLOYER_FAQS.find((f) => f.q.startsWith(start))?.a ?? "";

describe("the employers page's facts", () => {
  it("counts the day's reads of DOL from the server's own timers, and says weekday because one runs only then", () => {
    expect(answer("Will I hear")).toContain(`${CASE_CHECKS.length} times each weekday`);
    expect(CASE_CHECKS.some((c) => c.weekdays)).toBe(true);
  });

  it("says morning or early evening, which is when the follow sweep runs", () => {
    // Arrange: the sweep's timer, as Convex holds it (UTC).
    const crons = readFileSync(join(process.cwd(), "convex/crons.ts"), "utf8");
    const hours = /"employer-alerts",\s*"(\d+) ([\d,]+) \* \* \*"/.exec(crons)?.[2]?.split(",").map(Number) ?? [];
    // Assert: two runs, landing at 7 or 8 AM and 6 or 7 PM Eastern whichever way the clocks stand.
    expect(hours).toEqual([12, 23]);
    expect(answer("Will I hear")).toContain("in the morning or the early evening, Eastern time");
  });

  it("gives the days after a certification as the site's own status page does", () => {
    expect(getStatusMeaning("CERTIFIED")?.deadline).toContain("180 calendar days");
    expect(answer("What happens after DOL certifies")).toContain("180 calendar days from the date DOL granted it");
  });

  it("names the tick box by its own label, and promises once a day as the follow does", () => {
    expect(EVERY_CASE_LABEL.startsWith("Every case too")).toBe(true);
    expect(EMPLOYER_STEPS[1].title).toBe("Tick Every case too");
    expect(answer("Will I hear")).toContain("Every case too");
    expect(followPromise("each")).toContain("one email a day at most");
    expect(answer("Will I hear")).toContain("one email on a day");
  });

  it("says it's free and promises nothing about later", () => {
    expect(answer("What does it cost")).toMatch(/^It's free/);
    for (const f of EMPLOYER_FAQS) expect(f.a).not.toMatch(/forever|always be free|will stay free|never charge/i);
  });

  it("keeps every answer short, plain and its own", () => {
    expect(new Set(EMPLOYER_FAQS.map((f) => f.q)).size).toBe(EMPLOYER_FAQS.length);
    for (const f of EMPLOYER_FAQS) {
      expect(f.q.endsWith("?")).toBe(true);
      expect(f.a.length).toBeLessThanOrEqual(400);
      expect(f.a).not.toMatch(/\u2014|!/);
    }
  });
});
