import { describe, expect, it } from "vitest";

import {
  A_PERM_CASE,
  INVITE_DAYS,
  RECIPIENT_EMAIL_MAX,
  SOMEONE,
  canonicalAddress,
  caseLine,
  REMINDER_INVITES_PER_ADDRESS,
  copiesByCase,
  declineUrl,
  inviteCaseLine,
  inviterName,
  looksLikeALink,
  normaliseRecipientEmail,
  reminderAddressKey,
  reminderConfirmPurpose,
  reminderCopySubject,
  reminderDeclinePurpose,
  reminderStopPurpose,
  stopUrl,
} from "../reminderRecipients";
import { makeUnsubscribeToken } from "../unsubscribeToken";
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

describe("what the invitation calls the case", () => {
  const SCAM = "Refund due: verify at irs-refund.example/claim";

  it("is the job title at the employer, as the reminders name it", () => {
    expect(inviteCaseLine("Robotics Engineer", "ACME Robotics")).toBe("Robotics Engineer at ACME Robotics");
    expect(inviteCaseLine("Robotics Engineer", "ACME Robotics")).toBe(caseLine("Robotics Engineer", "ACME Robotics"));
  });

  it("is \"a PERM case\" when the job title reads like a link, so a stranger's inbox never carries one under our name", () => {
    expect(A_PERM_CASE).toBe("a PERM case");
    expect(inviteCaseLine(SCAM, "ACME Robotics")).toBe(A_PERM_CASE);
  });

  it("is \"a PERM case\" when the employer reads like a link or an address", () => {
    for (const employer of [
      SCAM,
      "Visit https://evil.example",
      "www.evil.example",
      "Call billing@bank.example",
      "Pay at irs.gov.",
      "IRS.GOV",
      "pay.example?x=1",
      "ACME (acme-refund.example)",
      "shop.xn--p1ai",
    ]) {
      expect(inviteCaseLine("Robotics Engineer", employer), employer).toBe(A_PERM_CASE);
    }
  });

  it("keeps an ordinary name with a full stop in it", () => {
    for (const employer of ["ACME Robotics, Inc.", "St. Jude Medical", "U.S. Steel", "J.P. Morgan Chase & Co."]) {
      expect(inviteCaseLine("Sr. Engineer", employer), employer).toBe(caseLine("Sr. Engineer", employer));
    }
  });

  it("is \"a PERM case\" when a look-alike dot stands in for the full stop", () => {
    for (const employer of [
      "irs-refund。com", // 。 ideographic full stop
      "irs-refund．com", // ． fullwidth full stop
      "irs-refund｡com", // ｡ halfwidth ideographic full stop
      "irs-refund․com", // ․ one dot leader
      "irs-refund﹒com", // ﹒ small full stop
    ]) {
      expect(inviteCaseLine("Robotics Engineer", employer), employer).toBe(A_PERM_CASE);
    }
  });

  it("is \"a PERM case\" when the domain is typed in fullwidth letters", () => {
    expect(inviteCaseLine("Robotics Engineer", "irs.ｃｏｍ")).toBe(A_PERM_CASE); // irs.ｃｏｍ
    expect(inviteCaseLine("Robotics Engineer", "ｗｗｗ.evil")).toBe(A_PERM_CASE); // ｗｗｗ.evil
  });

  it("is \"a PERM case\" when invisible characters sit between the letters", () => {
    for (const employer of [
      "irs.c​om", // zero-width space
      "irs.c‍o‌m", // zero-width joiner and non-joiner
      "irs⁠.com", // word joiner
      "w﻿ww.evil", // zero-width no-break space
      "irs.c­om", // soft hyphen
    ]) {
      expect(inviteCaseLine("Robotics Engineer", employer), JSON.stringify(employer)).toBe(A_PERM_CASE);
    }
  });

  it("is \"a PERM case\" when a letter outside plain ASCII sits next to a dot", () => {
    for (const employer of [
      "irs.сom", // Cyrillic с
      "irs.gоv", // Cyrillic о inside the domain
      "пример.рф", // пример.рф
      "banké.x",
    ]) {
      expect(inviteCaseLine("Robotics Engineer", employer), employer).toBe(A_PERM_CASE);
    }
  });

  it("is \"a PERM case\" when the words hold a phone number", () => {
    for (const employer of [
      "Call (800) 555-0199",
      "ACME +1 800.555.0199",
      "ACME 800 555 0199",
      "ACME 8005550199",
      "ACME ８００５５５０１９９", // fullwidth digits
      "ACME 800–555–0199", // en dashes
    ]) {
      expect(inviteCaseLine("Robotics Engineer", employer), employer).toBe(A_PERM_CASE);
    }
    expect(inviteCaseLine("Call 800-555-0199 today", "ACME Robotics")).toBe(A_PERM_CASE);
  });

  it("keeps ordinary names with accents, a few digits or a year", () => {
    for (const employer of [
      "Société Générale S.A.",
      "Nestlé USA, Inc.",
      "3M Company",
      "7-Eleven, Inc.",
      "ACME 2024 Holdings",
      "123 Main Street Partners",
    ]) {
      expect(inviteCaseLine("Software Engineer II", employer), employer).toBe(caseLine("Software Engineer II", employer));
    }
  });
});

describe("the link test itself", () => {
  it("says the same of a name and of its every look-alike", () => {
    expect(looksLikeALink("St. Jude Medical")).toBe(false);
    expect(looksLikeALink("U.S. Steel")).toBe(false);
    expect(looksLikeALink("J.P. Morgan Chase & Co.")).toBe(false);
    expect(looksLikeALink("irs-refund。com")).toBe(true);
    expect(looksLikeALink("support＠bank")).toBe(true); // ＠ fullwidth at sign
  });

  it("hides an inviter whose name holds a phone number or a look-alike link", () => {
    expect(inviterName("Call 800-555-0199", undefined)).toBe(SOMEONE);
    expect(inviterName("irs。gov", undefined)).toBe(SOMEONE);
    expect(inviterName("Jordan Lee", undefined)).toBe("Jordan Lee");
  });

  it("stays fast on a very long input", () => {
    const started = Date.now();
    looksLikeALink(`${"1 ".repeat(3)}a`.repeat(200_000));
    looksLikeALink(".".repeat(1_000_000));
    // A long run of letters with no "://" after it: a scheme pattern that starts at every letter is quadratic here.
    looksLikeALink("a".repeat(200_000));
    looksLikeALink("a.".repeat(100_000));
    expect(Date.now() - started).toBeLessThan(1500);
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

  it("follows the owner's master email switch: off, the second person gets nothing", () => {
    const off = prefs({ emailNotificationsEnabled: false });
    const out = copiesByCase([
      { ...base, caseId: "c1", deadlineType: "pwd_expiration", daysUntilDeadline: 7, userPrefs: off },
      { ...base, caseId: "c1", deadlineType: "rfi_due", daysUntilDeadline: 3, userPrefs: off },
    ]);
    expect(out.size).toBe(0);
  });

  it("follows the owner's deadline reminders switch: off, the second person gets nothing", () => {
    const off = prefs({ emailDeadlineReminders: false });
    const out = copiesByCase([
      { ...base, caseId: "c1", deadlineType: "filing_window_closes", daysUntilDeadline: 7, userPrefs: off },
      { ...base, caseId: "c1", deadlineType: "rfe_due", daysUntilDeadline: 3, userPrefs: off },
    ]);
    expect(out.size).toBe(0);
  });

  it("gets exactly the reminders the owner's own email gets", () => {
    // An RFI's due date is emailed by the RFI and RFE alerts switch too (shouldSendEmail).
    const out = copiesByCase([
      { ...base, caseId: "c1", deadlineType: "rfi_due", daysUntilDeadline: 3, userPrefs: prefs({ emailRfeAlerts: false }) },
      { ...base, caseId: "c1", deadlineType: "pwd_expiration", daysUntilDeadline: 7, userPrefs: prefs({ emailRfeAlerts: false }) },
    ]);
    expect(out.get("c1")?.map((i) => i.deadlineType)).toEqual(["PWD expiration"]);
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

describe("\"Don't invite me again\"", () => {
  it("has its own purpose, scoped to one invitation, so no other link declines and it confirms or stops nothing", () => {
    expect(reminderDeclinePurpose("abc123")).toBe("reminder-decline:abc123");
    expect(reminderDeclinePurpose("abc123")).not.toBe(reminderStopPurpose("abc123"));
    expect(reminderDeclinePurpose("abc123")).not.toBe(reminderConfirmPurpose("abc123"));
  });

  it("opens its own page on the site with the row and the signed token", () => {
    expect(declineUrl("tok/en+", "row1")).toBe("https://permtracker.app/case-alert/reminders/decline?token=tok%2Fen%2B&r=row1");
  });
});

describe("the address as one inbox", () => {
  it("is lowercased, with a +tag dropped on every domain", () => {
    expect(canonicalAddress(" Para+News@Firm.Example ")).toBe("para@firm.example");
    expect(canonicalAddress("para+a+b@firm.example")).toBe("para@firm.example");
    expect(canonicalAddress("p.ara@firm.example")).toBe("p.ara@firm.example");
  });

  it("drops a Gmail address's dots and reads googlemail.com as gmail.com", () => {
    expect(canonicalAddress("Para.Legal+promo@googlemail.com")).toBe("paralegal@gmail.com");
    expect(canonicalAddress("p.a.r.a@gmail.com")).toBe("para@gmail.com");
  });

  it("keeps a local part that would be left empty", () => {
    expect(canonicalAddress("+tag@firm.example")).toBe("+tag@firm.example");
    expect(canonicalAddress(".@gmail.com")).toBe(".@gmail.com");
  });
});

describe("the address as the refusal list and the invitation count keep it", () => {
  const SECRET = "a-test-secret";

  it("is a keyed one-way hash of the lowercased address, never the address", async () => {
    const key = await reminderAddressKey("para@firm.example", SECRET);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key).not.toContain("para");
    expect(await reminderAddressKey("  Para@FIRM.example ", SECRET)).toBe(key);
    expect(await reminderAddressKey("other@firm.example", SECRET)).not.toBe(key);
  });

  it("is the same for every spelling that reaches the same inbox", async () => {
    const key = await reminderAddressKey("para@firm.example", SECRET);
    for (const same of ["para+news@firm.example", "Para+a+b@FIRM.example", " para+@firm.example "]) {
      expect(await reminderAddressKey(same, SECRET), same).toBe(key);
    }
    const gmail = await reminderAddressKey("para.legal@gmail.com", SECRET);
    for (const same of ["paralegal@gmail.com", "P.a.r.a.L.e.g.a.l+promo@GoogleMail.com", "para.legal@googlemail.com"]) {
      expect(await reminderAddressKey(same, SECRET), same).toBe(gmail);
    }
    // Dots count everywhere else.
    expect(await reminderAddressKey("p.ara@firm.example", SECRET)).not.toBe(key);
  });

  it("needs the secret: another key gives another hash", async () => {
    expect(await reminderAddressKey("para@firm.example", "another-secret")).not.toBe(
      await reminderAddressKey("para@firm.example", SECRET),
    );
  });

  it("is never the signature of a link we mail, so the table can't be used to make one", async () => {
    const key = await reminderAddressKey("para@firm.example", SECRET);
    for (const purpose of [undefined, reminderStopPurpose("r1"), reminderDeclinePurpose("r1")] as const) {
      const token = await makeUnsubscribeToken("para@firm.example", SECRET, purpose);
      expect(token.split(".")[1]).not.toBe(key);
    }
  });

  it("lets one account invite one address twice in all", () => {
    expect(REMINDER_INVITES_PER_ADDRESS).toBe(2);
  });
});
