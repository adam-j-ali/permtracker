import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The same PERM answers in every reader's time zone. A local-midnight parse read back in UTC is the day before east
 * of UTC, which put a July 1 wage determination on the 90-day rule and every queue estimate a day early in India,
 * Europe, China and Australia (convex/lib/perm/calculators/pwd.ts and queueEstimate.ts, fixed Nov 9 2026).
 *
 * The suite's workers keep the New York zone they started with (vitest.config.ts), so each zone runs in a child
 * process started with its own TZ, loading the TypeScript through the repo's own jiti.
 */
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const CALCULATORS = path.join(ROOT, "convex/lib/perm/calculators");
const JITI = path.join(ROOT, "node_modules/jiti/lib/jiti-cli.mjs");
const dir = mkdtempSync(path.join(tmpdir(), "perm-tz-"));
const probe = path.join(dir, "probe.ts");
writeFileSync(
  probe,
  `import { calculatePWDExpiration } from ${JSON.stringify(path.join(CALCULATORS, "pwd.ts"))};
import { estimateQueueDecision } from ${JSON.stringify(path.join(CALCULATORS, "queueEstimate.ts"))};
const average = estimateQueueDecision({
  filingDate: "2026-03-02",
  today: "2026-03-10",
  frontier: { analystQueueMonth: "2025-09", officialAvgDays: 30, asOf: "2026-03-09" },
}).models.find((m) => m.id === "dol-average");
console.log(JSON.stringify({
  offset: new Date(2026, 0, 15).getTimezoneOffset(),
  july1: calculatePWDExpiration("2026-07-01"),
  april2: calculatePWDExpiration("2026-04-02"),
  april1: calculatePWDExpiration("2026-04-01"),
  average: average?.estimatedDate,
}));
`,
);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function inZone(tz: string): Record<string, unknown> {
  const out = execFileSync(process.execPath, [JITI, probe], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
}

describe.each([
  { tz: "Asia/Kolkata", offset: -330 },
  { tz: "Australia/Sydney", offset: -660 },
  { tz: "America/Los_Angeles", offset: 480 },
])("in $tz", ({ tz, offset }) => {
  it("gives the same expiry and estimate as anywhere else", { timeout: 60_000 }, () => {
    const got = inZone(tz);
    // January: Sydney is on daylight time (UTC+11), Los Angeles on standard (UTC-8).
    expect(got.offset).toBe(offset);
    expect(got.july1).toBe("2027-06-30");
    expect(got.april2).toBe("2026-07-01");
    expect(got.april1).toBe("2026-06-30");
    expect(got.average).toBe("2026-04-01");
  });
});
