import { describe, expect, it } from "vitest";
import { closingBoxFor } from "../DataShell";

describe("the box each data page ends with", () => {
  it("asks for what the page's reader has at that step", () => {
    const cases: [string, string][] = [
      ["/perm-queue", "perm"],
      ["/perm-employers", "perm"],
      ["/perm-recruitment", "perm"],
      ["/pwd-cases", "wage"],
      ["/tools/pwd-calculator", "wage"],
      ["/perm-wages", "wage"],
      ["/uscis-receipt-blocks", "receipt"],
      ["/uscis-receipt-blocks/IOE09360", "receipt"],
      ["/i485-by-field-office/tampa-florida", "receipt"],
      ["/uscis-processing-times/i-765", "receipt"],
      ["/tools/i140-calculator", "receipt"],
      ["/tools/n400-early-filing", "receipt"],
      ["/opt-employers", "receipt"],
      ["/green-card-timelines", "receipt"],
      ["/tools/green-card-line", "bulletin"],
      ["/tools/eb2-vs-eb3", "bulletin"],
      ["/consular-posts", "consulate"],
      ["/nvc-waiting-list", "consulate"],
      ["/visa-refusals", "consulate"],
      ["/lca-cases", "dol"],
      ["/seasonal-cases", "dol"],
    ];
    for (const [path, box] of cases) expect([path, closingBoxFor(path)]).toEqual([path, box]);
  });
});
