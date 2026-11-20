import { describe, expect, it } from "vitest";

import { DELETED_CASE_DAYS } from "@convex/lib/deletedCases";
import { CASE_DELETE_WARNING, caseDeleteWarning } from "../deleteWarning";

describe("what a delete box says", () => {
  it("says the case can be restored from Settings for as long as its copy is kept, and what's erased at once", () => {
    expect(DELETED_CASE_DAYS).toBe(30);
    expect(CASE_DELETE_WARNING).toBe(caseDeleteWarning(1));
    expect(caseDeleteWarning(1)).toContain(`restore it for ${DELETED_CASE_DAYS} days from Recently deleted in Settings`);
    expect(caseDeleteWarning(1)).toContain("Its documents and recruitment log are erased now");
    expect(caseDeleteWarning(3)).toContain("You can restore them");
    expect(caseDeleteWarning(3)).toContain("Their documents and recruitment logs are erased now");
    // Nothing says it's for good any more.
    for (const n of [1, 2]) expect(caseDeleteWarning(n)).not.toMatch(/undone|for good|permanent/i);
  });
});
