// @vitest-environment jsdom
/**
 * The two emails a case's second reminder recipient can get (convex/reminderRecipients.ts). The invitation names who
 * asked and the case, says what the reminders hold, carries one Confirm button and no way into an account, and says
 * what happens if it's ignored. The reminder lists that case's deadlines, says the reader confirmed them and when it
 * was checked in Eastern time, names nobody, and carries its one-click stop and no settings link.
 */
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { ReminderCopy } from "../ReminderCopy";
import { ReminderInvite } from "../ReminderInvite";

const CONFIRM = "https://permtracker.app/case-alert/reminders/confirm?token=T&r=R";
const DECLINE = "https://permtracker.app/case-alert/reminders/decline?token=D&r=R";
const STOP = "https://permtracker.app/case-alert/reminders/stop?token=S&r=R";

/** The rendered email as a document: parsed, never run. */
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

function wordsOf(html: string): string {
  return (parse(html).body.textContent ?? "").replace(/\s+/g, " ");
}

function linksOf(html: string): { href: string; text: string }[] {
  return [...parse(html).querySelectorAll("a")].map((a) => ({ href: a.getAttribute("href") ?? "", text: (a.textContent ?? "").trim() }));
}

describe("the invitation", () => {
  it("names who asked and the case, says what comes and how it stops, above one Confirm button", async () => {
    const html = await render(
      ReminderInvite({ inviter: "Jordan Lee", caseLine: "Robotics Engineer at ACME Robotics", confirmUrl: CONFIRM, declineUrl: DECLINE }),
    );
    const text = wordsOf(html);
    expect(text).toContain("Robotics Engineer at ACME Robotics");
    expect(text).toContain("Jordan Lee tracks this PERM case on PERM Tracker and asked us to send you its deadline reminders too.");
    expect(text).toContain("The emails name the employer, the job title and the deadlines, and nothing else from the case.");
    expect(text).toContain("stops them with one click");
    expect(text.indexOf("stops them with one click")).toBeLessThan(text.indexOf("Confirm the reminders"));
    expect(text).toContain("If you don’t want these, ignore this email. Nothing more will be sent, and we’ll delete your address in 30 days.");
    const confirm = linksOf(html).filter((a) => a.href === CONFIRM);
    expect(confirm).toEqual([{ href: CONFIRM, text: "Confirm the reminders" }]);
  });

  it("offers a way never to be invited again, after the Confirm button", async () => {
    const html = await render(
      ReminderInvite({ inviter: "Jordan Lee", caseLine: "Analyst at Initech", confirmUrl: CONFIRM, declineUrl: DECLINE }),
    );
    expect(linksOf(html).filter((a) => a.href === DECLINE)).toEqual([{ href: DECLINE, text: "Don’t invite me again" }]);
    const text = wordsOf(html);
    expect(text.indexOf("Confirm the reminders")).toBeLessThan(text.indexOf("Don’t invite me again"));
    expect(text).toMatch(/no one on PERM Tracker can invite this address again/i);
  });

  it("opens a sentence with \"A PERM Tracker user\" when no name can be shown", async () => {
    const html = await render(
      ReminderInvite({ inviter: "a PERM Tracker user", caseLine: "Analyst at Initech", confirmUrl: CONFIRM, declineUrl: DECLINE }),
    );
    expect(wordsOf(html)).toContain("A PERM Tracker user tracks this PERM case");
  });

  it("carries no link into the app or its settings", async () => {
    const html = await render(
      ReminderInvite({ inviter: "Jordan Lee", caseLine: "Analyst at Initech", confirmUrl: CONFIRM, declineUrl: DECLINE }),
    );
    const hrefs = linksOf(html).map((a) => a.href);
    expect(hrefs.some((h) => /\/settings|\/dashboard|\/cases\//.test(h))).toBe(false);
  });
});

describe("the reminder", () => {
  const items = [
    { deadlineType: "ETA 9089 filing window closes", deadlineDate: "2026-11-19", daysUntil: -1, urgency: "overdue" as const },
    { deadlineType: "PWD expiration", deadlineDate: "2026-11-27", daysUntil: 7, urgency: "urgent" as const },
  ];

  it("lists the case's deadlines, most urgent first, and says the reader confirmed them and when it was checked", async () => {
    const html = await render(
      ReminderCopy({
        caseLine: "Robotics Engineer at ACME Robotics",
        items,
        checkedAt: "November 20, 2026, 9:00 AM ET",
        stopUrl: STOP,
      }),
    );
    const text = wordsOf(html);
    expect(text).toContain("Robotics Engineer at ACME Robotics");
    expect(text).toContain("2 deadlines need attention, 1 overdue. Here’s what’s due, most urgent first.");
    expect(text.indexOf("ETA 9089 filing window closes")).toBeLessThan(text.indexOf("PWD expiration"));
    expect(text).toContain("November 27, 2026");
    expect(text).toContain("You confirmed these reminders. Checked November 20, 2026, 9:00 AM ET.");
    // The account that added the reader isn't named: the invitation already said who asked.
    expect(text).not.toMatch(/added you/);
  });

  it("carries the one-click stop and no settings link", async () => {
    const html = await render(
      ReminderCopy({ caseLine: "Analyst at Initech", items, checkedAt: "November 20, 2026, 9:00 AM ET", stopUrl: STOP }),
    );
    const links = linksOf(html);
    expect(links).toContainEqual({ href: STOP, text: "Stop these reminders" });
    expect(links.some((a) => /\/settings|\/dashboard|\/cases\//.test(a.href))).toBe(false);
  });
});
