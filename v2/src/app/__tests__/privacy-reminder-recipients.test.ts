import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INVITE_DAYS } from "@convex/lib/reminderRecipients";

/**
 * The Privacy Policy says what adding a second person to a case's deadline reminders does
 * (convex/reminderRecipients.ts): one email to confirm, naming who asked and the case ("a PERM case" when its words
 * break the plain-text rule, isPlainText); reminders only after it confirms, naming the employer, the job title and
 * the deadlines only, by the owner's own email switches; a one-click stop that ends the account's reminders to the
 * address on every case, and a "don't invite me again" link, each deleting the address and putting it on a refusal
 * list kept as a keyed one-way hash; two invitations per account per address; the address
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
    expect(section).toContain("That email names you by the name on your account, cut short if it's long");
    expect(section).toContain(
      "It calls you a PERM Tracker user when your account has no name, or when the name breaks the plain-text rule",
    );
    // The rule as isPlainText (convex/lib/reminderRecipients.ts) holds it: an allow-list of characters, then the
    // shapes of a link, an address and a phone number.
    // PLAIN_PUNCTUATION allows round brackets only, and the hyphen, the en dash and the em dash.
    expect(section).toContain(
      "Under that rule, a name may hold only Latin letters (the common accented ones included), digits, spaces and a few punctuation marks: hyphens and dashes, round brackets, the ampersand, comma, apostrophe, full stop and slash",
    );
    expect(section).not.toContain("full stop, brackets, slash");
    // isPlainText checks the shapes as they're written, so the sentence says "written as" and claims no more:
    // an address retyped in words ("irs-refund dot com") is a known limit.
    expect(section).toContain("Nothing in it may be written as a web address, an email address or a phone number either");
    expect(section).not.toContain("may read like a web address");
    expect(section).toContain(
      "It names the case by its employer and job title, or calls it a PERM case when either one breaks the same rule",
    );
    expect(section).not.toContain("reads like a web or email address or a phone number");
  });

  it("says the reminders go only after it confirms, and name the employer, the job title and the deadlines only", () => {
    expect(section).toContain("Only after it confirms do we send it that case's deadline reminders");
    expect(section).toContain("They name the employer, the job title and the deadlines only");
    expect(section).toContain("not even your name");
    // The reminders hold the case's words back by the same rule as the invitation, on every send.
    expect(section).toContain("They call the case a PERM case by the same rule, checked each time one is sent");
  });

  it("says the reminders follow the owner's master, deadline reminders and per-deadline switches", () => {
    expect(section).toContain("They follow your own email switches in Settings");
    expect(section).toContain('When "Email notifications", "Deadline reminders" or the switch for a kind of deadline is off');
    expect(section).toContain("that reminder goes to neither of you");
  });

  it("says one click stops them on every case the account added the address to, and the invitation's link declines, each deleting the address", () => {
    expect(section).toContain("Each reminder has a link that stops them with one click");
    expect(section).toContain("It ends your account's reminders to that address on every case and deletes the address from each one");
    expect(section).toContain("The invitation has a link that says not to invite the address again, and it deletes the address from that invitation");
    expect(section).toContain("Each case shows you that they were stopped");
    // A Stop reaches past the one case in its email, so the line can't say it deletes "the address" from one case only.
    expect(section).not.toContain("Either one deletes the address");
  });

  it("says the invitation's link refuses every account, and a reminder's Stop only yours, on a list kept as a keyed hash", () => {
    expect(section).toContain("The invitation's link puts the address on a list that refuses every account's invitations to it from then on");
    expect(section).toContain("A reminder's Stop link puts it on the list for your account only");
    expect(section).not.toContain("Either link also puts the address on a list");
    expect(section).toContain("keyed one-way hash of each address");
    expect(section).toContain("can't be read back as addresses");
    expect(section).toContain("A refusal of every account has no time limit. A refusal of your account is deleted with your account");
  });

  it("says a refused address gets one plain answer, and each try counts toward the day's invitations", () => {
    expect(section).toContain(
      "you get one plain answer that doesn't say which: an address that refused, one we can't email, and one you've invited twice all look the same",
    );
    expect(section).toContain(`Each try counts toward the {REMINDER_INVITES_PER_ACCOUNT.limit} invitations your account can send a day`);
    expect(page).toContain('import { REMINDER_INVITES_PER_ACCOUNT } from "@convex/lib/alertBudgets"');
  });

  it("says one account can invite one address twice in all, and what's kept to count them", () => {
    expect(section).toContain("Your account can invite the same address twice in all, even if an invitation lapsed or you removed it");
    expect(section).toContain("To count them, we keep the same keyed hash of the address with your account, never the address");
    expect(section).toContain("We also keep the number of invitations and the date of the last one. It's all deleted with your account");
  });

  it("says any email still waiting to be resent goes with the address", () => {
    expect(section).toContain("When the address goes, so does any email to it still waiting to be resent");
  });

  it("lists the refusal list in the retention schedule, each kind for its own time", () => {
    expect(page).toContain(
      "<strong>Addresses that asked not to get a case's deadline reminders</strong> are kept as a keyed one-way hash. One that said not to be invited again is kept with no time limit, so no account can invite it again. One that stopped an account's reminders is kept until that account is deleted, so that account can't invite it again",
    );
    expect(page).not.toContain("with no time limit, so no account can invite them again");
  });

  it("says how long the address is kept, and that an unconfirmed invitation goes after its days", () => {
    expect(section).toContain("We keep the address until it stops the reminders, you remove it, or you delete the case or your account");
    expect(section).toContain(`deleted, with its address, after ${INVITE_DAYS} days`);
    expect(page).toContain(`<strong>An invitation to a case's deadline reminders</strong> that isn't confirmed is deleted, with its address, after ${INVITE_DAYS} days`);
  });

  it("is dated the day it changed, or a later change's day", () => {
    // A later change moves the date on; it can never go back before this one.
    const dated = /Last Updated: ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(page)?.[1];
    expect(dated).toBeDefined();
    expect(Date.parse(dated!)).toBeGreaterThanOrEqual(Date.parse("November 23, 2026"));
  });
});
