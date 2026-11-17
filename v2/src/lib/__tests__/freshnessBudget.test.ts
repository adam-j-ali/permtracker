import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { QUARTERLY_FILE_MAX_AGE_DAYS, budgetFor } from "../freshnessBudget";

describe("a dataset's freshness budget", () => {
  it("is the same number the ingest scripts stamp for a DOL quarterly file", () => {
    const py = readFileSync(join(process.cwd(), "scripts/lib_db.py"), "utf8");
    const m = /^QUARTERLY_FILE_MAX_AGE_DAYS = (\d+)$/m.exec(py);
    expect(m && Number(m[1])).toBe(QUARTERLY_FILE_MAX_AGE_DAYS);
  });

  it("never lets a quarterly row warn before DOL's next file could exist (Nov 17 2026: 140 days against 135)", () => {
    expect(budgetFor("Quarterly with the files", 135)).toBe(220);
    expect(budgetFor("Rebuilt with each quarterly load", 135)).toBe(220);
    expect(budgetFor("Quarterly", 220)).toBe(220);
  });

  it("keeps a larger budget, and leaves every other cadence as it was stamped", () => {
    expect(budgetFor("Quarterly", 300)).toBe(300);
    expect(budgetFor("Daily", 3)).toBe(3);
    expect(budgetFor("monthly", 100)).toBe(100);
    expect(budgetFor("Quarterly", null)).toBeNull();
  });
});
