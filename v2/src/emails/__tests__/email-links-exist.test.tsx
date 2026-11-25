// @vitest-environment jsdom
/**
 * Every link in every email goes to a page that exists.
 *
 * Each template is rendered (its preview props, and for the ones that say what comes next, each path through those
 * steps), every `href` on permtracker.app is read off the HTML, and each one must be served: a page under src/app, a
 * file under public/, or a mail route nginx relays to Convex (test-utils/sitePages.ts). An anchor must be an id some
 * page or component writes. The plain-text parts the senders build from the same words, and the congratulations
 * notes, are read the same way.
 *
 * A new template has to join the list below, or the first test fails.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "react-email";

import {
  alsoLinksFor,
  bulletinNextSteps,
  forSavedCase,
  type NextStepInput,
  nextStepsFor,
  nextStepsText,
  receiptNextSteps,
} from "@convex/lib/alertNextSteps";
import { composeNotes, type NoteProgram } from "@convex/lib/congratsNote";
import { actionUrl, SITE_URL } from "@convex/lib/links";
import { composeText, type DigestData } from "@convex/lib/newsletterCompose";
import { oneClickUnsubscribeUrl } from "@convex/lib/prefsLink";
import { receiptBlockUrl, receiptPageUrl } from "@convex/lib/uscisWatch";
import { RATING_PATH } from "@convex/alertRatings";
import { anchorExists, sitePageFor } from "../../../test-utils/sitePages";

import { AccountDeletionConfirm } from "../AccountDeletionConfirm";
import { AdminEmail } from "../AdminEmail";
import { AutoClosure } from "../AutoClosure";
import { BulletinAlertConfirm } from "../BulletinAlertConfirm";
import { BulletinMoved } from "../BulletinMoved";
import { BulletinWeekly } from "../BulletinWeekly";
import { CaseAlertConfirm } from "../CaseAlertConfirm";
import { CaseStatusChanged, type CaseStatusChangedProps } from "../CaseStatusChanged";
import { DailyReport } from "../DailyReport";
import { DailyUpdate } from "../DailyUpdate";
import { DeadlineDigest } from "../DeadlineDigest";
import { DigestConfirm } from "../DigestConfirm";
import { EmailPreferencesLink } from "../EmailPreferencesLink";
import { EmployerAlertConfirm } from "../EmployerAlertConfirm";
import { EmployerMoved } from "../EmployerMoved";
import { FirmClaimEmail } from "../FirmClaimEmail";
import { PasswordResetCode } from "../PasswordResetCode";
import { PolicyChange } from "../PolicyChange";
import { PossiblePermMatch } from "../PossiblePermMatch";
import { QueueAlertConfirm } from "../QueueAlertConfirm";
import { QueueReached } from "../QueueReached";
import { ReengagementNudge } from "../ReengagementNudge";
import { ReminderCopy } from "../ReminderCopy";
import { ReminderInvite } from "../ReminderInvite";
import { StatusChange } from "../StatusChange";
import { TestEmail } from "../TestEmail";
import { UscisAlertConfirm } from "../UscisAlertConfirm";
import { UscisStatusChanged, type UscisChangedItem } from "../UscisStatusChanged";
import { VerificationCode } from "../VerificationCode";
import { WeeklyDigest } from "../WeeklyDigest";
import { WelcomeEmail } from "../WelcomeEmail";

/** A template rendered with the preview props it ships for the React Email dev server. */
function preview<P>(template: ((props: P) => React.ReactElement) & { PreviewProps?: unknown }): React.ReactElement {
  return template(template.PreviewProps as P);
}

const TOKEN = "T0KEN";
const PREFS = `${actionUrl("/prefs", TOKEN)}&focus=case:1`;
const CASE = "G-100-26070-123456";
const CASE_URL = `${SITE_URL}/perm-case-status?case=${CASE}`;

const caseAlert = (over: Partial<CaseStatusChangedProps>, input?: NextStepInput): React.ReactElement =>
  CaseStatusChanged({
    caseNumber: CASE,
    employerName: "Example Systems, Inc.",
    jobTitle: "Software Engineer",
    fromStatus: "ANALYST REVIEW",
    toStatus: "CERTIFIED",
    tone: "live",
    isFinal: true,
    observedAt: "October 15, 2026",
    contextRows: [{ label: "Cases now at this status", value: "906" }],
    contextProvenance: "Counted from DOL's own case status, checked daily.",
    employerRows: [{ label: "Decisions DOL has published", value: "47" }],
    employerUrl: `${SITE_URL}/perm-employers/example-systems-inc`,
    caseUrl: CASE_URL,
    unsubscribeUrl: actionUrl("/case-alert/unsubscribe", TOKEN),
    prefsUrl: PREFS,
    ratingUrl: `${SITE_URL}${RATING_PATH}?token=${TOKEN}&c=${CASE}`,
    timelineUrl: `${CASE_URL}#timeline`,
    ...(input ? { next: nextStepsFor(input), alsoLinks: alsoLinksFor(input) } : {}),
    ...over,
  });

const decided = (over: Partial<NextStepInput>): NextStepInput => ({
  program: "perm",
  caseNumber: CASE,
  status: "CERTIFIED",
  isFinal: true,
  approved: true,
  priorityDate: "2026-03-11",
  certifiedOn: "2026-10-15",
  employerName: "Example Systems, Inc.",
  jobTitle: "Software Engineer",
  ...over,
});

const CASE_INPUTS: Record<string, NextStepInput> = {
  "a certified PERM": decided({}),
  "a denied PERM": decided({ status: "DENIED", approved: false, certifiedOn: null, deniedOn: "2026-10-15" }),
  "the appeals board's denial": decided({ status: "DENIED - BALCA AFFIRMED", approved: false, certifiedOn: null }),
  "an RFI": decided({ status: "RFI ISSUED", isFinal: false, approved: false }),
  "a PERM job's wage": decided({ program: "pwd", caseNumber: "P-100-26118-846661", status: "DETERMINATION ISSUED" }),
  "an H-1B job's wage": decided({ program: "pwd", caseNumber: "P-200-26118-846661", status: "DETERMINATION ISSUED" }),
  "an H-1B LCA": decided({ program: "lca", caseNumber: "I-200-26118-846661" }),
  "an E-3 LCA": decided({ program: "lca", caseNumber: "I-203-26118-846661" }),
};

const receipt = (over: Partial<UscisChangedItem>): UscisChangedItem => ({
  receipt: "IOE0000000000",
  form: "I-140",
  fromStatus: "Case Was Received",
  toStatus: "Case Was Approved",
  tone: "good",
  isFinal: true,
  checkedAt: "4:12 AM ET, Nov 24",
  statusUrl: receiptPageUrl("IOE0000000000"),
  blockUrl: receiptBlockUrl("IOE0000000000"),
  dolCaseNumber: CASE,
  dolCaseUrl: CASE_URL,
  ...over,
});

const RECEIPTS: Record<string, UscisChangedItem[]> = {
  "an approved I-140": [receipt({})],
  "a request for evidence": [receipt({ toStatus: "Request for Additional Evidence Was Sent", tone: "bad", isFinal: false })],
  "an I-485 still waiting": [receipt({ form: "I-485", toStatus: "Fingerprint Fee Was Received", tone: "neutral", isFinal: false })],
  "two receipts, a paper one among them": [
    receipt({ form: "I-485", tone: "neutral", isFinal: false }),
    receipt({
      receipt: "EAC3512345678",
      form: "I-765",
      tone: "neutral",
      isFinal: false,
      statusUrl: receiptPageUrl("EAC3512345678"),
      blockUrl: receiptBlockUrl("EAC3512345678"),
      dolCaseNumber: null,
      dolCaseUrl: null,
    }),
  ],
};

const digest: DigestData = {
  weekOf: "2026-09-08",
  dolAsOf: "2026-08-31",
  frontierMonth: "2025-11",
  averageDays: 336,
  pendingCases: 97025,
  bulletinMonth: "2026-09",
  bulletinMoves: { advanced: 5, held: 25, retrogressed: 0, total: 30 },
  notices: [],
  prefsUrl: actionUrl("/prefs", TOKEN),
  watchedCase: { caseNumber: CASE, status: "CERTIFIED", url: CASE_URL },
};

const caseId = "c1" as never;

/** Every email, by the file it lives in. A file may render several ways. */
const EMAILS: Array<[file: string, name: string, make: () => React.ReactElement]> = [
  ["AccountDeletionConfirm.tsx", "preview", () => preview(AccountDeletionConfirm)],
  ["AdminEmail.tsx", "preview", () => preview(AdminEmail)],
  ["AutoClosure.tsx", "preview", () => preview(AutoClosure)],
  [
    "BulletinAlertConfirm.tsx",
    "EB-2 India",
    () => BulletinAlertConfirm({ seriesLabel: "EB-2 India", confirmUrl: actionUrl("/bulletin-alert/confirm", TOKEN) }),
  ],
  [
    "BulletinMoved.tsx",
    "EB-2 India moved",
    () =>
      BulletinMoved({
        seriesLabel: "EB-2 India",
        bulletinMonth: "December 2026",
        fromCutoff: "January 1, 2013",
        toCutoff: "February 1, 2013",
        unsubscribeUrl: actionUrl("/bulletin-alert/unsubscribe", TOKEN),
        prefsUrl: PREFS,
      }),
  ],
  ["BulletinWeekly.tsx", "with a certified case watched", () => BulletinWeekly(digest)],
  ["CaseAlertConfirm.tsx", "preview", () => preview(CaseAlertConfirm)],
  ["CaseStatusChanged.tsx", "preview", () => preview(CaseStatusChanged)],
  ...Object.entries(CASE_INPUTS).map(
    ([name, input]): [string, string, () => React.ReactElement] => [
      "CaseStatusChanged.tsx",
      name,
      () => caseAlert({ caseNumber: input.caseNumber, toStatus: input.status, isFinal: input.isFinal }, input),
    ],
  ),
  [
    "DailyReport.tsx",
    "a report",
    () =>
      DailyReport({
        report: {
          day: "2026-11-23",
          generatedAt: 0,
          sections: [{ key: "site", title: "The site", status: "ok", summary: "Every page answered", lines: [] }],
        },
      }),
  ],
  [
    "DailyUpdate.tsx",
    "two items",
    () =>
      DailyUpdate({
        items: [
          { kind: "case", title: CASE, line: "ANALYST REVIEW to CERTIFIED", url: CASE_URL, tone: "good" },
          { kind: "employer", title: "Adobe Inc.", line: "DOL put 215 of its cases on hold", url: `${SITE_URL}/perm-employers/adobe-inc`, tone: "bad" },
        ],
        prefsUrl: actionUrl("/prefs", TOKEN),
        stopUrl: oneClickUnsubscribeUrl(TOKEN, "alerts"),
      }),
  ],
  ["DeadlineDigest.tsx", "preview", () => preview(DeadlineDigest)],
  ["DigestConfirm.tsx", "preview", () => preview(DigestConfirm)],
  ["EmailPreferencesLink.tsx", "a link", () => EmailPreferencesLink({ prefsUrl: actionUrl("/prefs", TOKEN) })],
  [
    "EmployerAlertConfirm.tsx",
    "Adobe",
    () => EmployerAlertConfirm({ employerName: "Adobe Inc.", confirmUrl: actionUrl("/employer-alert/confirm", TOKEN) }),
  ],
  [
    "EmployerMoved.tsx",
    "a case-by-case follow",
    () =>
      EmployerMoved({
        employerName: "Adobe Inc.",
        employerUrl: `${SITE_URL}/perm-employers/adobe-inc`,
        moves: [
          {
            dateLabel: "Sep 24",
            sentence: "DOL certified 2 of its cases",
            tone: "good",
            cases: [{ number: CASE, url: CASE_URL, note: "Software Engineer, filed Mar 2025" }],
          },
        ],
        mix: { pending: 250, queue: 30, review: 216, appeal: 4, held: 216 },
        asOf: "September 25, 2026",
        unsubscribeUrl: actionUrl("/employer-alert/unsubscribe", TOKEN),
        prefsUrl: PREFS,
      }),
  ],
  ...(["confirm", "approved", "published", "declined", "edit"] as const).map(
    (kind): [string, string, () => React.ReactElement] => [
      "FirmClaimEmail.tsx",
      kind,
      () => FirmClaimEmail({ kind, firmName: "Example Law PLLC", url: actionUrl(`/firm-claim/${kind}`, TOKEN), validFor: "7 days", reason: "Not the firm." }),
    ],
  ),
  ["PasswordResetCode.tsx", "preview", () => preview(PasswordResetCode)],
  ["PolicyChange.tsx", "preview", () => preview(PolicyChange)],
  ["PossiblePermMatch.tsx", "preview", () => preview(PossiblePermMatch)],
  [
    "QueueAlertConfirm.tsx",
    "March 2025",
    () => QueueAlertConfirm({ filingMonth: "March 2025", confirmUrl: actionUrl("/queue-alert/confirm", TOKEN) }),
  ],
  ...(["PERM queue", "prevailing wage queue"] as const).map(
    (queueName): [string, string, () => React.ReactElement] => [
      "QueueReached.tsx",
      queueName,
      () =>
        QueueReached({
          frontierMonth: "September 2025",
          filingMonth: "March 2025",
          asOf: "August 20, 2026",
          monthsPast: 6,
          unsubscribeUrl: actionUrl("/queue-alert/unsubscribe", TOKEN),
          prefsUrl: PREFS,
          queueName,
          source: "check",
        }),
    ],
  ),
  ["ReengagementNudge.tsx", "preview", () => preview(ReengagementNudge)],
  ["ReminderCopy.tsx", "preview", () => preview(ReminderCopy)],
  ["ReminderInvite.tsx", "preview", () => preview(ReminderInvite)],
  ["StatusChange.tsx", "preview", () => preview(StatusChange)],
  [
    "StatusChange.tsx",
    "DOL certified a saved case",
    () =>
      StatusChange({
        ...StatusChange.PreviewProps,
        previousStatus: "ANALYST REVIEW",
        newStatus: "CERTIFIED",
        caseNumber: CASE,
        next: forSavedCase(nextStepsFor(decided({})), StatusChange.PreviewProps.caseUrl),
      }),
  ],
  ["TestEmail.tsx", "preview", () => preview(TestEmail)],
  ["UscisAlertConfirm.tsx", "preview", () => preview(UscisAlertConfirm)],
  ["UscisStatusChanged.tsx", "preview", () => preview(UscisStatusChanged)],
  ...Object.entries(RECEIPTS).map(
    ([name, items]): [string, string, () => React.ReactElement] => [
      "UscisStatusChanged.tsx",
      name,
      () =>
        UscisStatusChanged({
          items,
          unsubscribeUrl: actionUrl("/uscis-alert/unsubscribe", TOKEN),
          prefsUrl: PREFS,
          next: receiptNextSteps(items),
        }),
    ],
  ),
  ["VerificationCode.tsx", "preview", () => preview(VerificationCode)],
  [
    "WeeklyDigest.tsx",
    "a week with a deadline",
    () =>
      WeeklyDigest({
        digestContent: {
          userName: "A. Person",
          userEmail: "person@example.com",
          weekStartDate: "2026-09-28",
          weekEndDate: "2026-10-04",
          stats: { totalActiveCases: 1, overdueCount: 0, urgentCount: 1, unreadNotificationCount: 0 },
          overdueDeadlines: [],
          next7DaysDeadlines: [
            { caseId, employerName: "Acme Corp", beneficiaryIdentifier: "A. Person", deadlineType: "I-140 filing deadline", deadlineDate: "2026-10-02", daysUntil: 4, urgency: "urgent" },
          ],
          next14DaysDeadlines: [],
          recentCaseUpdates: [
            { caseId, employerName: "Acme Corp", beneficiaryIdentifier: "A. Person", caseStatus: "i140", updatedAt: 0, changeDescription: "Moved to I-140" },
          ],
          isEmpty: false,
          emptyMessage: "",
        },
        unsubscribeUrl: oneClickUnsubscribeUrl(TOKEN, "weekly"),
      }),
  ],
  ["WelcomeEmail.tsx", "preview", () => preview(WelcomeEmail)],
];

/** Every `href` an email carries, unescaped. */
function hrefsIn(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.split("&amp;").join("&"));
}

/** Every permtracker.app address a plain-text part carries, with or without its scheme. */
function addressesIn(text: string): string[] {
  return [...text.matchAll(/(?:https:\/\/)?permtracker\.app(\/[^\s"'<>),]*)?/g)].map(
    (m) => `${SITE_URL}${(m[1] ?? "/").replace(/[.:;]+$/, "")}`,
  );
}

/** Why `href` leads nowhere, or null when it leads somewhere. Other sites' links are theirs to keep. */
function brokenBecause(href: string): string | null {
  if (href.startsWith("mailto:")) return null;
  const url = new URL(href);
  if (url.hostname !== "permtracker.app") return url.protocol === "https:" ? null : "not https";
  if (sitePageFor(url.pathname) === null) return "no page serves this path";
  const id = url.hash.slice(1);
  if (id && !anchorExists(id)) return `no page writes the id "${id}"`;
  return null;
}

describe("every link in every email", () => {
  it("covers every template", () => {
    const files = readdirSync(join(process.cwd(), "src/emails")).filter((f) => f.endsWith(".tsx"));
    expect(new Set(EMAILS.map(([file]) => file))).toEqual(new Set(files));
  });

  it.each(EMAILS.map(([file, name, make]) => [`${file} (${name})`, make] as const))(
    "%s links only to pages that exist",
    async (_name, make) => {
      const links = hrefsIn(await render(make()));
      expect(links.length).toBeGreaterThan(0);
      const broken = links.flatMap((h) => {
        const why = brokenBecause(h);
        return why ? [`${h}: ${why}`] : [];
      });
      expect(broken).toEqual([]);
    },
  );

  it("the plain-text parts built from the same steps link only to pages that exist", () => {
    const texts = [
      ...Object.values(CASE_INPUTS).map((i) => nextStepsText(nextStepsFor(i)).join("\n")),
      ...Object.values(RECEIPTS).map((items) => nextStepsText(receiptNextSteps(items)).join("\n")),
      nextStepsText(bulletinNextSteps()).join("\n"),
      composeText(digest),
    ];
    const broken = texts.flatMap(addressesIn).filter((h) => brokenBecause(h) !== null);
    expect(broken).toEqual([]);
  });

  it("the congratulations notes name only addresses the site serves", () => {
    const programs: NoteProgram[] = ["perm", "lca", "pwd"];
    const body = composeNotes(programs.map((program, i) => ({ program, caseNumber: `${CASE.slice(0, -1)}${i}` }))).body;
    const addresses = addressesIn(body);
    expect(addresses.length).toBeGreaterThan(4);
    expect(addresses.filter((h) => brokenBecause(h) !== null)).toEqual([]);
  });

  it("would catch a link to a page that doesn't exist, and an anchor no page writes", () => {
    expect(brokenBecause(`${SITE_URL}/tools/i140-calculatr`)).toBe("no page serves this path");
    expect(brokenBecause(`${SITE_URL}/guides/no-such-guide`)).toBe("no page serves this path");
    expect(brokenBecause(`${SITE_URL}/uscis-processing-times/i-000`)).toBe("no page serves this path");
    expect(brokenBecause(`${SITE_URL}/visa-bulletin#bulletin-alrt`)).toBe('no page writes the id "bulletin-alrt"');
    expect(brokenBecause("http://example.com/")).toBe("not https");
    // And lets through what's real: a page, a dynamic page, a guide, a mail route, a file.
    expect(brokenBecause(`${SITE_URL}/visa-bulletin?pd=2026-03-11#bulletin-alert`)).toBeNull();
    expect(brokenBecause(`${SITE_URL}/perm-employers/adobe-inc`)).toBeNull();
    expect(brokenBecause(`${SITE_URL}/guides/perm-certified-what-next`)).toBeNull();
    expect(brokenBecause(actionUrl("/uscis-alert/unsubscribe", TOKEN))).toBeNull();
    expect(brokenBecause(`${SITE_URL}${RATING_PATH}?token=${TOKEN}`)).toBeNull();
  });
});
