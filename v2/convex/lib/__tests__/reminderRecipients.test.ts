import { describe, expect, it } from "vitest";

import {
  INVITE_DAYS,
  RECIPIENT_EMAIL_MAX,
  SOMEONE,
  copiesByCase,
  inviterName,
  normaliseRecipientEmail,
  reminderCopySubject,
  reminderStopPurpose,
  stopUrl,
} from "../reminderRecipients";
import { buildUserNotificationPrefs, type UserNotificationPrefs } from "../notificationHelpers";

/**
 * The rules for a case's second reminder recipient that need no database (convex/reminderRecipients.ts): the
 * address as stored, who the email says asked, which of the day's reminders the second person gets, and the
 * one-click stop link.
 */

const prefs = (over: Partial<UserNotificationPrefs> = {}): UserNotificationPrefs => ({
  ...buildUserNotificationPrefs({ emailNotificationsEnabled: true, emailDeadlineReminders: true }),
  ...over,
});

describe("the second person's address", () => {
  it("is trimmed and lowercased", () => {
    expect(normaliseRecipientEmail("  Para.Legal@Firm.COM ")).toBe("para.legal@firm.com");
  });

  it("refuses what isn't an address", () => {
    for (const bad of ["", "   ", "no-at-sign", "a@b", "two words@firm.com", "a@b@c.com"]) {
      expect(normaliseRecipientEmail(bad)).toBeNull();
    }
  });

  it("refuses one longer than an address can be, before any pattern runs", () => {
    const long = `${"a".repeat(RECIPIENT_EMAIL_MAX)}@firm.com`;
    expect(normaliseRecipientEmail(long)).toBeNull();
    // A megabyte of text is turned away at once rather than trimmed and matched.
    const started = Date.now();
    expect(normaliseRecipientEmail(`a@${".".repeat(1_000_000)}@`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe("who the email says asked", () => {
  it("is the account's display name when it has one", () => {
    expect(inviterName("Jordan Lee", "jordan")).toBe("Jordan Lee");
    expect(inviterName(undefined, "  Sam Park ")).toBe("Sam Park");
  });

  it("is a PERM Tracker user when there's no name", () => {
    expect(SOMEONE).toBe("a PERM Tracker user");
    expect(inviterName(undefined, undefined)).toBe(SOMEONE);
    expect(inviterName("   ", "")).toBe(SOMEONE);
  });

  it("is a PERM Tracker user when the name reads like a link or an address, so a stranger's email can't carry one", () => {
    for (const name of ["Visit https://evil.example", "www.evil.example", "support@bank.example", "evil.com"]) {
      expect(inviterName(name, undefined)).toBe(SOMEONE);
    }
  });

  it("keeps a long name to one line", () => {
    expect(inviterName("A".repeat(300), undefined).length).toBeLessThanOrEqual(60);
  });
});

describe("which of the day's reminders the second person gets", () => {
  const base = { deadlineDate: "2026-12-01", userPrefs: prefs() };

  it("only the reminders of their own case, most urgent first", () => {
    const out = copiesByCase([
      { ...base, caseId: "c1", deadlineType: "pwd_expiration", daysUntilDeadline: 30, deadlineDate: "2026-12-20" },
      { ...base, caseId: "c2", deadlineType: "pwd_expiration", daysUntilDeadline: 7 },
      { ...base, caseId: "c1", deadlineType: "filing_window_closes", daysUntilDeadline: -1, deadlineDate: "2026-11-19" },
    ]);
    expect([...out.keys()].sort()).toEqual(["c1", "c2"]);
    expect(out.get("c1")).toEqual([
      { deadlineType: "ETA 9089 filing window closes", deadlineDate: "2026-11-19", daysUntil: -1, urgency: "overdue" },
      { deadlineType: "PWD expiration", deadlineDate: "2026-12-20", daysUntil: 30, urgency: "later" },
    ]);
    expect(out.get("c2")).toHaveLength(1);
  });

  it("follows the owner's switch for each kind of deadline", () => {
    const out = copiesByCase([
      { ...base, caseId: "c1", deadlineType: "pwd_expiration", daysUntilDeadline: 7, userPrefs: prefs({ emailDeadlineReminderPwd: false }) },
      { ...base, caseId: "c1", deadlineType: "rfi_due", daysUntilDeadline: 3, userPrefs: prefs({ emailDeadlineReminderPwd: false }) },
    ]);
    expect(out.get("c1")?.map((i) => i.deadlineType)).toEqual(["RFI response due"]);
  });

  it("leaves out a case whose every reminder is switched off", () => {
    const out = copiesByCase([
      { ...base, caseId: "c1", deadlineType: "i140_filing_deadline", daysUntilDeadline: 7, userPrefs: prefs({ emailDeadlineReminderI140: false }) },
    ]);
    expect(out.size).toBe(0);
  });
});

describe("the email's subject", () => {
  it("names the deadlines and the case", () => {
    expect(reminderCopySubject(1, 0, "Software Engineer", "Acme Corp")).toBe(
      "1 PERM deadline needs your attention: Software Engineer at Acme Corp",
    );
    expect(reminderCopySubject(2, 2, "Analyst", "Initech")).toBe("2 PERM deadlines are overdue: Analyst at Initech");
  });

  it("keeps a long title and employer short", () => {
    expect(reminderCopySubject(1, 0, "T".repeat(500), "E".repeat(500)).length).toBeLessThanOrEqual(160);
  });
});

describe("the one-click stop", () => {
  it("is scoped to one recipient row, so a link for one case can't stop another", () => {
    expect(reminderStopPurpose("abc123")).toBe("reminder-stop:abc123");
    expect(reminderStopPurpose("abc123")).not.toBe(reminderStopPurpose("abc124"));
  });

  it("opens the stop page on the site with the row and the signed token", () => {
    expect(stopUrl("tok/en+", "row1")).toBe("https://permtracker.app/case-alert/reminders/stop?token=tok%2Fen%2B&r=row1");
  });

  it("gives an invitation thirty days", () => {
    expect(INVITE_DAYS).toBe(30);
  });
});
