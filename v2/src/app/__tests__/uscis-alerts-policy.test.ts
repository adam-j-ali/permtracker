import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MS_PER_DAY } from "@convex/lib/time";
import { UNCONFIRMED_WATCH_DAYS, WATCH_AFTER_FINAL_MS } from "@convex/lib/uscisWatch";

/**
 * The receipt-alerts section of the Privacy Policy and the tables behind the beta (convex/schema.ts:
 * uscisWatches, uscisReceipts) say the same thing. A field the policy doesn't name is a policy that is wrong, and
 * a number typed into the policy that the code doesn't keep is a promise nobody holds, so both are read here.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** The top-level fields of one table in convex/schema.ts. */
function fieldsOf(table: string): string[] {
  const schema = read("convex/schema.ts");
  const start = schema.indexOf(`  ${table}: defineTable({`);
  expect(start, `${table} in the schema`).toBeGreaterThan(0);
  const end = schema.indexOf("\n  })", start);
  return [...schema.slice(start, end).matchAll(/^ {4}(\w+): v\./gm)].map((m) => m[1]!);
}

const policy = read("src/app/(site)/(public)/privacy/page.tsx");
const section = policy.slice(policy.indexOf('id="uscis-receipt-alerts"'), policy.indexOf('id="changes-to-this-policy"'));

describe("the receipt-alerts section of the Privacy Policy", () => {
  it("sits in the USCIS section, before the next one", () => {
    expect(policy.indexOf('id="uscis-receipt-alerts"')).toBeGreaterThan(policy.indexOf('id="uscis-case-status"'));
    expect(section.length).toBeGreaterThan(500);
  });

  it("names every field the watch keeps, and the watch keeps nothing else", () => {
    // Each field, and the words in the policy that cover it.
    const covered: Record<string, string> = {
      email: "your email address",
      receipt: "the receipt numbers you ask us to watch",
      dolCaseNumber: "a DOL case number if you add one",
      createdAt: "when you signed up",
      source: "", // which of our pages the form was on: ours, not about the person
      confirmedAt: "when you confirmed",
      lastConfirmationSentAt: "", // when we last sent the confirmation: ours, a throttle
      confirmationOwed: "",
      lastAlertedStatus: "the status we last emailed you about",
      lastAlertedAt: "",
      alertDue: "",
      sendingAt: "",
      sendingStatus: "",
      sendingRef: "",
    };
    const fields = fieldsOf("uscisWatches");
    expect(fields.filter((f) => !(f in covered)), "a field the policy doesn't cover").toEqual([]);
    for (const [field, words] of Object.entries(covered)) {
      expect(fields, field).toContain(field);
      if (words) expect(section, field).toContain(words);
    }
  });

  it("names what's kept per receipt, and that table keeps nothing about a person", () => {
    const fields = fieldsOf("uscisReceipts");
    expect(fields.sort()).toEqual(["changedAt", "checkedAt", "finalSince", "form", "group", "notFound", "receipt", "status", "watchers"].sort());
    expect(section).toContain("USCIS&apos;s newest status, when we last checked it");
  });

  it("states the numbers the code keeps", () => {
    expect(UNCONFIRMED_WATCH_DAYS).toBe(30);
    expect(section).toContain(`deleted after ${UNCONFIRMED_WATCH_DAYS} days`);
    expect(WATCH_AFTER_FINAL_MS).toBe(365 * MS_PER_DAY);
    expect(section).toContain("a year after a final decision");
    expect(section).toContain("every 4 hours");
  });

  it("says how to stop, and that a receipt is never published or shared", () => {
    expect(section).toContain("one-click link that stops the alerts");
    expect(section).toContain("Stopping deletes the receipts");
    expect(section).toContain("A receipt number is never published or shared");
    expect(section).toContain("never your email address");
  });

  it("no longer promises alerts that don't exist yet", () => {
    expect(policy).not.toContain("If alerts on USCIS receipts are ever offered");
  });
});
