import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SEARCH_MISS_ON } from "@/lib/funnelEvents";
import { RECEIPT_LAST_STATUS_SHOWN } from "@/lib/uscisSample";

/**
 * A switch that starts a new use of information is on only while the Privacy Policy describes that use. Turning one on
 * without its policy text, or cutting the text while the switch is on, fails here.
 */
const POLICY = readFileSync(join(process.cwd(), "src/app/(site)/(public)/privacy/page.tsx"), "utf8");

const SWITCHES: { name: string; on: boolean; heading: string; says: RegExp }[] = [
  {
    name: "SEARCH_MISS_ON",
    on: SEARCH_MISS_ON,
    heading: "Searches that find nothing",
    says: /we record the words typed \(up to 60 characters\)/,
  },
  {
    name: "typed numbers watched (TypedReceiptBeacon)",
    on: true,
    heading: "Our sample of USCIS cases",
    says: /A receipt number typed into the lookup joins the numbers\s+our sample checks each week, with the numbers around it/,
  },
  {
    name: "block pages list their numbers (uscis-receipt-blocks/[block]/numbers)",
    on: true,
    heading: "Our sample of USCIS cases",
    says: /on each receipt\s+block&apos;s page, the receipt numbers we checked[\s\S]{0,120}Those pages are kept out of search engines/,
  },
  {
    name: "RECEIPT_LAST_STATUS_SHOWN",
    on: RECEIPT_LAST_STATUS_SHOWN,
    heading: "Our sample of USCIS cases",
    says: /the lookup shows the last status we\s+saw for it and the day we saw it/,
  },
];

describe("a switch is on only while the Privacy Policy describes it", () => {
  for (const s of SWITCHES) {
    it(`${s.name} has its policy text when on`, () => {
      if (!s.on) return;
      expect(POLICY, `${s.name} is on, so the policy needs "${s.heading}"`).toContain(s.heading);
      expect(POLICY).toMatch(s.says);
    });
  }

  it("the search words the policy names match the code's cap", async () => {
    const { SEARCH_MISS_MAX } = await import("@/lib/funnelEvents");
    expect(POLICY).toContain(`(up to ${SEARCH_MISS_MAX} characters)`);
  });
});

describe("the pages the policy keeps out of search engines", () => {
  it("a block's list of numbers is noindex", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(site)/(public)/uscis-receipt-blocks/[block]/numbers/page.tsx"), "utf8");
    expect(page).toMatch(/robots: \{ index: false, follow: true \}/);
  });
});
