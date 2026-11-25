/** No typed measurement outlives its recheck day, and each register entry still names a real constant. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TYPED_MEASUREMENTS } from "../typedMeasurements";

const ROOT = join(__dirname, "../../..");
const todayEastern = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

describe("TYPED_MEASUREMENTS", () => {
  it.each(TYPED_MEASUREMENTS.map((m) => [m.name, m] as const))("%s is still defined where the register says", (_n, m) => {
    expect(readFileSync(join(ROOT, m.file), "utf8")).toMatch(new RegExp(`export const ${m.name}\\b`));
  });

  it("has none past its recheck day", () => {
    const due = TYPED_MEASUREMENTS.filter((m) => m.recheckBy < todayEastern).map((m) => `${m.name}: ${m.next} (due ${m.recheckBy})`);
    expect(due).toEqual([]);
  });

  it("writes each recheck day as a real day", () => {
    for (const m of TYPED_MEASUREMENTS) expect(Number.isNaN(Date.parse(`${m.recheckBy}T12:00:00Z`))).toBe(false);
  });
});
