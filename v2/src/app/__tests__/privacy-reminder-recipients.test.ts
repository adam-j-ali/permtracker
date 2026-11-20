import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INVITE_DAYS } from "@convex/lib/reminderRecipients";

/**
 * The Privacy Policy says what adding a second person to a case's deadline reminders does
 * (convex/reminderRecipients.ts): one email to confirm, naming who asked and the case ("a PERM case" when its words
 * read like a link); reminders only after it confirms, naming the employer, the job title and the deadlines only,
 * by the owner's own email switches; a one-click stop, and a "don't invite me again" link, that delete the address
 * and put it on a refusal list kept as a keyed one-way hash; two invitations per account per address; the address
 * kept until it stops them, the owner removes it, or the case or account is deleted, with any email still waiting
 * to be resent; an unconfirmed invitation deleted after 30 days.
 */
const SRC = join(process.cwd(), "src");
const flat = (s: string) => s.replace(/\s+/g, " ").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
const page = flat(readFileSync(join(SRC, "app/(site)/(public)/privacy/page.tsx"), "utf8"));
const section = page.slice(page.indexOf('id="reminder-recipients"'), page.indexOf('id="shared-recruitment-records"'));

describe("the privacy page and a case's second reminder recipient", () => {
  it("has the section among the case data", () => {
    expect(section.length).toBeGreaterThan(400);
    expect(page.indexOf('id="reminder-recipients"')).toBeGreaterThan(page.indexOf('id="counted-cases"'));
  });

  it("says the address is emailed once to confirm, naming who asked and the case, or not the case", () => {
    expect(section).toContain("we email it once to ask it to confirm");
    expect(section).toContain("calls you a PERM Tracker user");
    expect(section).toContain("by its employer and job title, or calls it a PERM case when either one reads like a web or email address");
  });

  it("says the reminders go only after it confirms, and name the employer, the job title and the deadlines only", () => {
    expect(section).toContain("Only after it confirms do we send it that case's deadline reminders");
    expect(section).toContain("They name the employer, the job title and the deadlines only");
    expect(section).toContain("not even your name");
  });

  it("says the reminders follow the owner's master, deadline reminders and per-deadline switches", () => {
    expect(section).toContain("They follow your own email switches in Settings");
    expect(section).toContain('When "Email notifications", "Deadline reminders" or the switch for a kind of deadline is off');
    expect(section).toContain("that reminder goes to neither of you");
  });

  it("says one click stops them, and the invitation's link declines, and either deletes the address", () => {
    expect(section).toContain("stops them with one click");
    expect(section).toContain("the invitation has a link that says not to invite the address again");
    expect(section).toContain("Either one deletes the address");
  });

  it("says either link puts the address on a refusal list kept as a keyed one-way hash", () => {
    expect(section).toContain("refuses every account's invitations to it from then on");
    expect(section).toContain("keyed one-way hash of each address");
    expect(section).toContain("can't be read back as addresses");
  });

  it("says one account can invite one address twice in all, counted by the same hash", () => {
    expect(section).toContain("Your account can invite the same address twice in all, even if an invitation lapsed or you removed it");
    expect(section).toContain("the same keyed hash of the address with your account, never the address");
  });

  it("says any email still waiting to be resent goes with the address", () => {
    expect(section).toContain("When the address goes, so does any email to it still waiting to be resent");
  });

  it("lists the refusal list in the retention schedule", () => {
    expect(page).toContain(
      "<strong>Addresses that asked not to get a case's deadline reminders</strong> are kept as a keyed one-way hash, with no time limit, so no account can invite them again",
    );
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
