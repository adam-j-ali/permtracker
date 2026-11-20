import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INVITE_DAYS } from "@convex/lib/reminderRecipients";

/**
 * The Privacy Policy says what adding a second person to a case's deadline reminders does
 * (convex/reminderRecipients.ts): one email to confirm, naming who asked and the case; reminders only after it
 * confirms, naming the employer, the job title and the deadlines; a one-click stop that deletes the address; the
 * address kept until it stops them, the owner removes it, or the case or account is deleted; an unconfirmed
 * invitation deleted after 30 days.
 */
const SRC = join(process.cwd(), "src");
const flat = (s: string) => s.replace(/\s+/g, " ").replace(/&apos;/g, "'");
const page = flat(readFileSync(join(SRC, "app/(site)/(public)/privacy/page.tsx"), "utf8"));
const section = page.slice(page.indexOf('id="reminder-recipients"'), page.indexOf('id="shared-recruitment-records"'));

describe("the privacy page and a case's second reminder recipient", () => {
  it("has the section among the case data", () => {
    expect(section.length).toBeGreaterThan(400);
    expect(page.indexOf('id="reminder-recipients"')).toBeGreaterThan(page.indexOf('id="counted-cases"'));
  });

  it("says the address is emailed once to confirm, naming who asked and the case", () => {
    expect(section).toContain("we email it once to ask it to confirm");
    expect(section).toContain("calls you a PERM Tracker user");
    expect(section).toContain("by its employer and job title");
  });

  it("says the reminders go only after it confirms, and what they name", () => {
    expect(section).toContain("Only after it confirms do we send it that case's deadline reminders");
    expect(section).toContain("name the employer, the job title and the deadlines");
    expect(section).toContain("follow your own deadline switches in Settings");
  });

  it("says one click stops them and deletes the address", () => {
    expect(section).toContain("stops them with one click");
    expect(section).toContain("we delete the address");
  });

  it("says how long the address is kept, and that an unconfirmed invitation goes after its days", () => {
    expect(section).toContain("We keep the address until it stops the reminders, you remove it, or you delete the case or your account");
    expect(section).toContain(`deleted, with its address, after ${INVITE_DAYS} days`);
    expect(page).toContain(`<strong>An invitation to a case's deadline reminders</strong> that isn't confirmed is deleted, with its address, after ${INVITE_DAYS} days`);
  });

  it("is dated the day it changed", () => {
    expect(page).toContain("Last Updated: November 20, 2026");
  });
});
