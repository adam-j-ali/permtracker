import { describe, expect, it } from "vitest";

import {
  A_PERM_CASE,
  INVITE_DAYS,
  RECIPIENT_EMAIL_MAX,
  SOMEONE,
  REMINDER_INVITES_PER_ADDRESS,
  copiesByCase,
  declineUrl,
  safeCaseLine,
  inviterName,
  isPlainText,
  normaliseRecipientEmail,
  reminderAddressKey,
  reminderConfirmPurpose,
  reminderCopySubject,
  reminderDeclinePurpose,
  reminderStopPurpose,
  stopUrl,
} from "../reminderRecipients";
import { APP_GUIDE_SECTIONS } from "../rag/appGuideKnowledge";
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

  it("is a PERM Tracker user when a domain ends right at the 60-character cut, where the ellipsis goes", () => {
    // 59 characters show before the ellipsis: the domain ends exactly there.
    expect(`${"A".repeat(45)}irs-refund.com`).toHaveLength(59);
    expect(inviterName(`${"A".repeat(45)}irs-refund.com9tail`, undefined)).toBe(SOMEONE);
  });

  it("is a PERM Tracker user for a name in another script, or one dressed with invisible marks or look-alike dots", () => {
    for (const name of [
      "王伟",
      "राहुल शर्मा",
      "Иван Петров",
      "Jordan͏ Lee", // combining grapheme joiner
      "irs·gov", // middle dot
      "irs. gov", // hair space after the dot
      "Call 800/555/0199",
    ]) {
      expect(inviterName(name, undefined), JSON.stringify(name)).toBe(SOMEONE);
    }
  });
});

describe("what the invitation calls the case", () => {
  const SCAM = "Refund due: verify at irs-refund.example/claim";
  const line = (title: string, employer: string) => `${title} at ${employer}`;

  it("is the job title at the employer, as the reminders name it", () => {
    expect(safeCaseLine("Robotics Engineer", "ACME Robotics")).toBe("Robotics Engineer at ACME Robotics");
  });

  it("is \"a PERM case\" when the job title reads like a link, so a stranger's inbox never carries one under our name", () => {
    expect(A_PERM_CASE).toBe("a PERM case");
    expect(safeCaseLine(SCAM, "ACME Robotics")).toBe(A_PERM_CASE);
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
      "irs-refund.com",
      "irs-refund.com9tail",
      ".NET Solutions",
      "a.bc",
    ]) {
      expect(safeCaseLine("Robotics Engineer", employer), employer).toBe(A_PERM_CASE);
    }
  });

  it("keeps an ordinary name with a full stop in it", () => {
    for (const employer of ["ACME Robotics, Inc.", "St. Jude Medical", "U.S. Steel", "J.P. Morgan Chase & Co."]) {
      expect(safeCaseLine("Sr. Engineer", employer), employer).toBe(line("Sr. Engineer", employer));
    }
  });

  it("is \"a PERM case\" when a look-alike dot stands in for the full stop", () => {
    for (const employer of [
      "irs-refund。com", // 。 ideographic full stop
      "irs-refund．com", // ． fullwidth full stop
      "irs-refund｡com", // ｡ halfwidth ideographic full stop
      "irs-refund․com", // ․ one dot leader
      "irs-refund﹒com", // ﹒ small full stop
      "irs-refundꓸcom", // Lisu letter tone mya ti
      "irs-refund٠com", // Arabic-Indic digit zero
      "irs-refund۰com", // extended Arabic-Indic digit zero
      "irs-refund܁com", // Syriac supralinear full stop
      "irs-refund܂com", // Syriac sublinear full stop
      "irs-refund꘎com", // Vai full stop
      "irs-refund·com", // middle dot
      "irs-refund·com", // Greek ano teleia
      "irs-refund・com", // katakana middle dot
      "irs-refund･com", // halfwidth katakana middle dot
      "irs-refund∙com", // bullet operator
      "irs-refund⋅com", // dot operator
      "irs-refundŀcom", // an l with a middle dot, which NFKC splits into l and the dot
      "irs-refundꞏcom", // Latin letter sinological dot, a Latin letter outside the ranges allowed
    ]) {
      expect(safeCaseLine("Robotics Engineer", employer), JSON.stringify(employer)).toBe(A_PERM_CASE);
    }
  });

  it("is \"a PERM case\" when the domain is typed in fullwidth letters", () => {
    expect(safeCaseLine("Robotics Engineer", "irs.ｃｏｍ")).toBe(A_PERM_CASE); // irs.ｃｏｍ
    expect(safeCaseLine("Robotics Engineer", "ｗｗｗ.evil")).toBe(A_PERM_CASE); // ｗｗｗ.evil
  });

  it("is \"a PERM case\" when invisible characters sit between the letters", () => {
    for (const employer of [
      "irs.c​om", // zero-width space
      "irs.c‍o‌m", // zero-width joiner and non-joiner
      "irs⁠.com", // word joiner
      "w﻿ww.evil", // zero-width no-break space
      "irs.c­om", // soft hyphen
      "irs-refund.c͏om", // combining grapheme joiner
      "irs-refund.c︀om", // variation selector 1
      "irs-refund.co️m", // variation selector 16
      "ACME͏ Robotics", // even with no dot near it
    ]) {
      expect(safeCaseLine("Robotics Engineer", employer), JSON.stringify(employer)).toBe(A_PERM_CASE);
    }
  });

  it("is \"a PERM case\" when a space that hides itself follows the dot", () => {
    for (const employer of [
      "irs-refund. com", // hair space
      "irs-refund. com", // thin space
      "irs-refund. com", // narrow no-break space
      "irs-refund. com", // no-break space
    ]) {
      expect(safeCaseLine("Robotics Engineer", employer), JSON.stringify(employer)).toBe(A_PERM_CASE);
    }
  });

  it("is \"a PERM case\" when a letter from another alphabet makes up the domain", () => {
    for (const employer of [
      "irs.сom", // Cyrillic с
      "irs.gоv", // Cyrillic о inside the domain
      "пример.рф", // пример.рф
    ]) {
      expect(safeCaseLine("Robotics Engineer", employer), employer).toBe(A_PERM_CASE);
    }
  });

  it("is \"a PERM case\" for a name in another script", () => {
    for (const employer of ["华为技术有限公司", "टाटा कंसल्टेंसी सर्विसेज", "Газпром", "ACME 株式会社"]) {
      expect(safeCaseLine("Robotics Engineer", employer), employer).toBe(A_PERM_CASE);
      expect(safeCaseLine(employer, "ACME Robotics"), employer).toBe(A_PERM_CASE);
    }
  });

  it("is \"a PERM case\" when the words hold a phone number, however its digits are split", () => {
    for (const employer of [
      "Call (800) 555-0199",
      "ACME +1 800.555.0199",
      "ACME 800 555 0199",
      "ACME 8005550199",
      "ACME ８００５５５０１９９", // fullwidth digits
      "ACME 800–555–0199", // en dashes
      "ACME 800/555/0199",
      "ACME 800_555_0199",
      "ACME 800,555,0199",
      "ACME 800•555•0199", // bullets
      "ACME 800|555|0199",
      "ACME 800 · 555 · 0199",
      "ACME 1 2 3 4 5 6 7",
    ]) {
      expect(safeCaseLine("Robotics Engineer", employer), employer).toBe(A_PERM_CASE);
    }
    expect(safeCaseLine("Call 800-555-0199 today", "ACME Robotics")).toBe(A_PERM_CASE);
  });

  it("keeps ordinary names with accents, a few digits, a year, a comma or brackets, as a title, an employer and a name", () => {
    for (const name of [
      "St. Jude",
      "U.S. Steel",
      "J.P. Morgan",
      "Société Générale S.A.",
      "Nestlé USA, Inc.",
      "3M",
      "3M Company",
      "7-Eleven",
      "7-Eleven, Inc.",
      "ACME 2024 Holdings",
      "123 Main Street Partners",
      "Level 3, Suite 400",
      "Software Engineer (Backend)",
      "O'Brien & Sons",
    ]) {
      expect(safeCaseLine("Software Engineer II", name), name).toBe(line("Software Engineer II", name));
      expect(safeCaseLine(name, "ACME Robotics"), name).toBe(line(name, "ACME Robotics"));
      expect(inviterName(name, undefined), name).toBe(name);
    }
  });

  it("shows an accent typed as a separate mark as the one letter it makes", () => {
    expect(safeCaseLine("Analyst", "Société Générale S.A.")).toBe("Analyst at Société Générale S.A.");
  });

  it("puts a name typed over several lines on one", () => {
    expect(safeCaseLine("Software\tEngineer", "ACME\n  Robotics ")).toBe("Software Engineer at ACME Robotics");
  });

  it("is \"a PERM case\" when a domain ends right at the 55-character cut, where the ellipsis goes", () => {
    // 54 characters show before the ellipsis: the domain ends exactly there.
    expect(`${"A".repeat(40)}irs-refund.com`).toHaveLength(54);
    const long = `${"A".repeat(40)}irs-refund.com9tail`;
    expect(safeCaseLine("Analyst", long)).toBe(A_PERM_CASE);
    expect(safeCaseLine(long, "ACME Robotics")).toBe(A_PERM_CASE);
  });

  it("cuts a long ordinary name at 55 characters with an ellipsis", () => {
    const long = `${"Robotics ".repeat(10)}Inc`;
    expect(safeCaseLine("Analyst", long)).toBe(`Analyst at ${long.slice(0, 54).trimEnd()}…`);
  });
});

describe("the plain-text rule itself", () => {
  it("passes a plain name and fails a link, an address or a look-alike", () => {
    expect(isPlainText("St. Jude Medical")).toBe(true);
    expect(isPlainText("U.S. Steel")).toBe(true);
    expect(isPlainText("J.P. Morgan Chase & Co.")).toBe(true);
    expect(isPlainText("Société Générale S.A.")).toBe(true);
    expect(isPlainText("a.b")).toBe(true);
    expect(isPlainText("irs-refund。com")).toBe(false);
    expect(isPlainText("support＠bank")).toBe(false); // ＠ fullwidth at sign
    expect(isPlainText(".NET")).toBe(false);
    expect(isPlainText("a.bc")).toBe(false);
    expect(isPlainText("irs-refund.com9tail")).toBe(false);
  });

  it("takes only the Latin letters it names, by their ranges", () => {
    expect(isPlainText("ÀÖØöøÿĀſ")).toBe(true);
    expect(isPlainText("×")).toBe(false); // the multiplication sign, between the ranges
    expect(isPlainText("÷")).toBe(false); // the division sign
    expect(isPlainText("ꞏ")).toBe(false); // a Latin letter that is a dot
    expect(isPlainText("ƀ")).toBe(false); // Latin Extended-B
  });

  it("counts the digits in the whole text: six pass, seven fail", () => {
    expect(isPlainText("123 456")).toBe(true);
    expect(isPlainText("123 4567")).toBe(false);
    expect(isPlainText("1-2-3-4-5-6-7")).toBe(false);
  });

  it("counts letters that pass for 0 or 1 as digits in a run that holds a real one: seven fail", () => {
    for (const s of [
      "IRS Refund Dept, call 8ØØ 555 Ø1ØØ",
      "call 8OO 555 O1OO",
      "8oo 555 o1oo",
      "8ØØ.555.Ø1ØØ",
      "(8OO) 555-O1OO",
      "8II 555 OlOO",
      "8ØØ,555,Ø1ØØ", // commas join the run as a space does
      "8ØØ'555'Ø1ØØ",
      "8ØØ & 555 & Ø1ØØ",
      "8ÖÖ 555 Ö1ÖÖ", // accented O
      "8óò 555 ô1õö",
      "8ŌŐ 555 ō1ŏő",
      "8ÍÌ 555 Ï1ıł", // accented I, a dotless i, an l with a stroke
    ]) {
      expect(isPlainText(s), s).toBe(false);
      expect(safeCaseLine("Robotics Engineer", s), s).toBe(A_PERM_CASE);
      expect(inviterName(s, undefined), s).toBe(SOMEONE);
    }
  });

  it("keeps names whose letters only look like digits, and short runs beside a few digits", () => {
    for (const s of [
      "Søren Bjørn Østergård",
      "Apollo 11 Labs",
      "Room 1010 Floor 10",
      "Software Engineer II (Level 3)",
      "Software Engineer III (Level 10)",
      "OOO Lilly Pool",
      "Polo 101 Ltd",
      "Firma 2000 Sp. z o.o.",
      "Asociación 2024 López",
    ]) {
      expect(isPlainText(s), s).toBe(true);
    }
  });

  it("fails a phone number written partly in letters, the vanity form", () => {
    for (const s of [
      "Call 1-800-FLOWERS",
      "1-800-IRS-HELP",
      "IRS desk 800-555-HELP",
      "212-555-HELP",
      "IRS Refund Desk 1-800-REFUNDS",
      "(800) FLOWERS",
      "Call (800) 555-HELP",
      "1 (800) FLOWERS",
      "call 1-800-flowers", // lower case
      "1.800.FLOWERS",
      "1/800/FLOWERS",
      "800–555–HELP", // en dashes
      "ACME, 1-800-FLOWERS, Inc.",
      "1 800 FLOWERS",
      "1-800 FLOWERS",
      "800 555 HELP",
      "800 - FLOWERS",
      "(800)FLOWERS",
      "1 800 555 HELP",
    ]) {
      expect(isPlainText(s), s).toBe(false);
      expect(safeCaseLine("Robotics Engineer", s), s).toBe(A_PERM_CASE);
      expect(safeCaseLine(s, "ACME Robotics"), s).toBe(A_PERM_CASE);
      expect(inviterName(s, undefined), s).toBe(SOMEONE);
    }
  });

  it("keeps ordinary names that hold a number beside words", () => {
    for (const s of [
      "St. Jude",
      "U.S. Steel",
      "J.P. Morgan",
      "3M",
      "7-Eleven",
      "ACME 2024 Holdings",
      "Level 3, Suite 400",
      "Software Engineer II (Level 3)",
      "Room 1010 Floor 10",
      "Apollo 11 Labs",
      "Søren Bjørn Østergård",
      "Priya D’Souza",
      "Macy’s, Inc.",
      "123 Main Street Partners",
      "Firma 2000 Sp. z o.o.",
      "Suite 400, 1 Main St",
      // A number then a space and a word of seven letters, or of three and four, as real names and titles have it.
      "Studio 360 Designs",
      "Club 360 Fitness",
      "Fortune 500 Company",
      "Since 1985 Company",
      "Dynamics 365 Finance & Operations Senior Developer",
      "201 Kia Blvd LLC",
    ]) {
      expect(isPlainText(s), s).toBe(true);
      expect(inviterName(s, undefined), s).toBe(s);
    }
  });

  it("fails a numeric web address, four numbers joined by dots", () => {
    for (const s of ["verify at 5.9.12.34", "1.1.1.1", "Refund 203.0.113.250 today", "１.１.１.１"]) {
      expect(isPlainText(s), s).toBe(false);
      expect(safeCaseLine("Robotics Engineer", s), s).toBe(A_PERM_CASE);
      expect(inviterName(s, undefined), s).toBe(SOMEONE);
    }
    // Three numbers, or four with a space after a dot, aren't an address.
    for (const s of ["Release 2.0.1", "Level 3, Suite 400", "Version 1. 2. 3. 4"]) {
      expect(isPlainText(s), s).toBe(true);
    }
  });

  it("fails a domain spelled with a space or a bracket after its dot", () => {
    for (const s of [
      "irs-refund. com",
      "irs-refund.  com",
      "irs-refund(.)com",
      "irs-refund (.) com",
      "irs-refund.(com)",
      "irs-refund. ( com )",
      "Pay at irs. GOV",
      "evil. net",
      "evil. org",
      "evil. edu",
      "evil. io",
      "evil. info",
      "evil. biz",
      "evil. app",
      "evil. us",
      "irs-refund. com9tail",
    ]) {
      expect(isPlainText(s), s).toBe(false);
      expect(safeCaseLine("Robotics Engineer", s), s).toBe(A_PERM_CASE);
      expect(inviterName(s, undefined), s).toBe(SOMEONE);
    }
  });

  it("keeps a full stop before a word that only starts like a domain, and \"Co\"", () => {
    for (const s of [
      "St. Jude Medical",
      "U.S. Steel",
      "J.P. Morgan Chase & Co.",
      "ACME Robotics, Inc.",
      "XYZ Inc. dba ABC",
      "Smith Ltd. Co",
      "Smith & Co. Comedy Club",
      "ACME Corp. Network Services",
      "ACME Inc. Usual Suspects",
      "ACME Inc. Comédie",
    ]) {
      expect(isPlainText(s), s).toBe(true);
    }
  });

  it("takes the typographic apostrophe, the en dash and the slash, as names and titles use them", () => {
    for (const s of ["Priya D’Souza", "O’Brien", "Macy’s, Inc.", "Software Engineer – Backend", "Software Developer/Engineer"]) {
      expect(isPlainText(s), s).toBe(true);
      expect(safeCaseLine(s, "ACME Robotics"), s).toBe(`${s} at ACME Robotics`);
      expect(safeCaseLine("Analyst", s), s).toBe(`Analyst at ${s}`);
      expect(inviterName(s, undefined), s).toBe(s);
    }
  });

  it("still fails a phone number, a numeric address or a domain that uses them", () => {
    for (const s of [
      "ACME 800–555–0199",
      "ACME 800/555/0199",
      "8ØØ/5ØØ/Ø1ØØ", // the slash joins a run of look-alike digits
      "8ØØ–5ØØ–Ø1ØØ",
      "8ØØ’5ØØ’Ø1ØØ",
      "irs-refund.com/claim",
      "irs-refund. com/claim",
      "5.9.12.34/claim",
      "https://evil",
    ]) {
      expect(isPlainText(s), s).toBe(false);
    }
  });

  it("fails www before a dot, a slash or a space and a word; a slash between two words is no link", () => {
    for (const s of ["www/irs", "www irs-refund", "WWW/ irs", "visit www. irs-refund"]) {
      expect(isPlainText(s), s).toBe(false);
    }
    // No dot, so no mail app makes a link of it, and it reads no nearer a link than "irs-refund dot com" does.
    expect(isPlainText("irs-refund/com")).toBe(true);
  });

  it("hides an inviter whose name holds a phone number or a look-alike link", () => {
    expect(inviterName("Call 800-555-0199", undefined)).toBe(SOMEONE);
    expect(inviterName("irs。gov", undefined)).toBe(SOMEONE);
    expect(inviterName("Jordan Lee", undefined)).toBe("Jordan Lee");
  });

  it("finishes a 50,000-character input fast, in time linear in its length", () => {
    const inputs = [
      "a".repeat(50_000),
      "a.".repeat(25_000),
      "1 ".repeat(25_000),
      `${"A".repeat(49_999)} `,
      "é".repeat(50_000),
      "é".repeat(25_000),
      "St. Jude ".repeat(5_555),
      "́".repeat(50_000),
      `${"a ".repeat(24_999)}️`,
    ];
    const started = performance.now();
    for (const s of inputs) {
      isPlainText(s);
      safeCaseLine(s, s);
      inviterName(s, s);
    }
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("stays fast on a very long input", () => {
    const started = Date.now();
    isPlainText(`${"1 ".repeat(3)}a`.repeat(200_000));
    isPlainText(".".repeat(1_000_000));
    isPlainText("a".repeat(200_000));
    isPlainText("a.".repeat(100_000));
    // A dot then a long gap, a bracket among spaces, a long joined run, and dotted numbers.
    isPlainText(`.${" ".repeat(1_000_000)}x`);
    isPlainText(".( ".repeat(330_000));
    isPlainText(`${" ".repeat(1_000_000)}1`);
    isPlainText("o ".repeat(500_000));
    isPlainText("1.".repeat(500_000));
    // Area codes over and over, each nearly the start of a phone number partly in letters.
    isPlainText("1-800-".repeat(50_000));
    isPlainText("(800) ".repeat(50_000));
    isPlainText("800-FLO".repeat(50_000));
    isPlainText("1 800 ".repeat(50_000));
    isPlainText("800 555 ".repeat(50_000));
    isPlainText("800 - ".repeat(50_000));
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

  it("calls the case \"a PERM case\" when its words read like a link or a phone number, as the invitation does", () => {
    expect(reminderCopySubject(1, 0, "Verify at irs-refund.example", "Acme Corp")).toBe(
      "1 PERM deadline needs your attention: a PERM case",
    );
    expect(reminderCopySubject(1, 0, "Analyst", "Call (800) 555-0199")).toBe("1 PERM deadline needs your attention: a PERM case");
  });
});

describe("the one-click stop", () => {
  it("is scoped to one recipient row and the account that added it, so a link for one case can't stop another", () => {
    expect(reminderStopPurpose("abc123", "user9")).toBe("reminder-stop:abc123:user9");
    expect(reminderStopPurpose("abc123", "user9")).not.toBe(reminderStopPurpose("abc124", "user9"));
    // The account is signed too, so the link can still refuse the address for it once the row is gone.
    expect(reminderStopPurpose("abc123", "user9")).not.toBe(reminderStopPurpose("abc123", "user8"));
  });

  it("opens the stop page on the site with the row, the account and the signed token", () => {
    expect(stopUrl("tok/en+", "row1", "user9")).toBe(
      "https://permtracker.app/case-alert/reminders/stop?token=tok%2Fen%2B&r=row1&u=user9",
    );
  });

  it("gives an invitation thirty days", () => {
    expect(INVITE_DAYS).toBe(30);
  });
});

describe("\"Don't invite me again\"", () => {
  it("has its own purpose, scoped to one invitation, so no other link declines and it confirms or stops nothing", () => {
    expect(reminderDeclinePurpose("abc123")).toBe("reminder-decline:abc123");
    expect(reminderDeclinePurpose("abc123")).not.toBe(reminderStopPurpose("abc123", "user9"));
    expect(reminderDeclinePurpose("abc123")).not.toBe(reminderConfirmPurpose("abc123"));
  });

  it("opens its own page on the site with the row and the signed token", () => {
    expect(declineUrl("tok/en+", "row1")).toBe("https://permtracker.app/case-alert/reminders/decline?token=tok%2Fen%2B&r=row1");
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
    for (const purpose of [undefined, reminderStopPurpose("r1", "u1"), reminderDeclinePurpose("r1")] as const) {
      const token = await makeUnsubscribeToken("para@firm.example", SECRET, purpose);
      expect(token.split(".")[1]).not.toBe(key);
    }
  });

  it("lets one account invite one address twice in all", () => {
    expect(REMINDER_INVITES_PER_ADDRESS).toBe(2);
  });
});

describe("what the chat's guide says about refusals", () => {
  const guide = APP_GUIDE_SECTIONS.map((s) => s.content).find((c) => c.includes("Reminders for someone else")) ?? "";

  it("finds the card's entry", () => {
    expect(guide.length).toBeGreaterThan(200);
  });

  it("says a Stop refuses only the account that added the address, and \"Don't invite me again\" every account", () => {
    expect(guide).toContain("An address that stopped these reminders can't be added again by your account");
    expect(guide).toContain("one that chose \"Don't invite me again\" in its invitation can't be added by anyone");
    expect(guide).not.toContain("An address that stopped these reminders or chose");
  });

  it("says a Stop ends the account's reminders to the address on every case", () => {
    expect(guide).toContain(
      "has a link that stops them with one click. That link ends your account's reminders to the address on every case and deletes the address from each one",
    );
    expect(guide).not.toContain("which deletes their address");
  });

  it("says a refused address gets one plain answer, and each try counts toward the day's five", () => {
    expect(guide).toContain("We can't send an invitation to that address");
    expect(guide).toContain("Each try counts toward the 5 a day");
  });
});
