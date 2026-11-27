/**
 * What comes next, after an alert: the step that follows the one DOL, USCIS or
 * the State Department just recorded, and the page or alert that helps with it.
 *
 * A green card is a chain of filings (the wage request, the PERM, the I-140,
 * the visa bulletin, the I-485), and a subscriber hears from us about one link
 * of it. The email that says that link is done is the one place the next link
 * is worth naming, so the final case alerts, the receipt alerts and the
 * bulletin alerts carry it, and the confirmation pages offer the next alert in
 * the chain.
 *
 * ## Rules every line here follows
 *
 * - **One step, one short sentence, one link.** The step that matters first
 *   comes first. A second sentence is there only when a computed date needs
 *   the caveat that says where the exact date is printed.
 * - **Links go only to pages and alerts that exist.** Each path below is held
 *   to a page under src/app by `alertNextSteps.test.ts`, and every link in
 *   every email by `email-links-exist.test.tsx`.
 * - **A link names its page as the site does.** A link to a page in the site
 *   map starts with that page's one name (src/lib/siteMap.ts), then says what
 *   it does there; the test holds the two equal.
 * - **No date is typed.** The I-140's last day comes from the central
 *   calculator (`calculateETA9089Expiration`, certification + 179, the date
 *   DOL prints), a denial's from `calculateDenialReviewDeadline` (the letter's
 *   date + 30), and the day each counts from is the day DOL's record changed,
 *   so the copy says "about" and points at the date on DOL's own paper.
 * - **A prevailing wage request is not always a PERM step.** `P-100` is a
 *   PERM job's wage; `P-200` to `P-203` are H-1B, H-1B1 and E-3 jobs', whose
 *   next filing is the LCA. Only `P-100` is told about the PERM.
 * - **The receipt alert is a beta, and nothing here prices it.** The owner's
 *   call for the USCIS tracking (Nov 11 2026): no price, never paid or free.
 * - **Nothing here says a case will be approved or when.**
 *
 * @module convex/lib/alertNextSteps
 */

import { SITE_URL } from "./links";
import { longDate } from "./months";
import { EASTERN_TIMEZONE, easternDay, MS_PER_DAY } from "./time";
import { calculateETA9089Expiration } from "./perm/calculators/eta9089";
import { calculateDenialReviewDeadline } from "./perm/calculators/denialReview";
import type { FlagProgram } from "../../src/lib/flagCaseNumber";

export interface NextLink {
  /** Absolute https://permtracker.app URL. */
  href: string;
  /** Self-describing link text. */
  text: string;
}

export interface NextStep {
  /** A short label, sentence case: "The I-140". */
  title: string;
  /** One short sentence; two only when a computed date needs its caveat. */
  body: string;
  /** The one page or alert for this step. Its text stands alone: the rating page shows it without the step. */
  link?: NextLink;
  /** Draw `link` as the block's button: the onward alert. One step at most. */
  button?: boolean;
}

export interface NextSteps {
  steps: NextStep[];
  /** Further reading after the steps, each one standing alone. */
  links: NextLink[];
}

export interface NextStepInput {
  program: FlagProgram;
  caseNumber: string;
  /** Canonical status (`canonicalStatus`). */
  status: string;
  isFinal: boolean;
  /** `isProgramApproval(program, status)`. */
  approved: boolean;
  /** This case's PERM filing day on DOL's record, "YYYY-MM-DD". PERM only. */
  priorityDate?: string | null;
  /** The day DOL's record showed the certification, "YYYY-MM-DD". PERM only. */
  certifiedOn?: string | null;
  /** The day DOL's record showed the denial, "YYYY-MM-DD". PERM's DENIED only. */
  deniedOn?: string | null;
  employerName?: string | null;
  jobTitle?: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The paths these emails link to, in one place so the route test can read
 * them. Anchors are part of the contract: `#bulletin-alert` and
 * `#queue-alert` are ids on the forms, `#step-by-step` the RFI page's
 * section.
 */
export const NEXT_PATHS = {
  bulletinAlert: "/visa-bulletin#bulletin-alert",
  queueAlert: "/tools/perm-timeline-calculator#queue-alert",
  certifiedGuide: "/guides/perm-certified-what-next",
  waitingGuide: "/guides/waiting-on-your-green-card",
  greenCardLine: "/tools/green-card-line",
  planner: "/tools/green-card-timeline",
  i140Wait: "/tools/i140-calculator",
  priorityDates: "/tools/priority-date-calculator",
  uscisTimes: "/uscis-processing-times",
  i129Times: "/uscis-processing-times/i-129",
  uscisLookup: "/uscis-case-status",
  uscisStatuses: "/uscis-case-statuses",
  rfeDeadline: "/tools/rfe-response-deadline",
  denialGuide: "/guides/perm-denied-what-happens-next",
  appealGuide: "/guides/perm-appeal-reconsideration-balca",
  rfiSteps: "/perm-rfi-audit#step-by-step",
  shareTimeline: "/green-card-timelines#add-h",
  deadlineTool: "/tools/perm-deadline-calculator",
  pwdValidity: "/tools/pwd-validity",
  lcaGuide: "/guides/what-an-lca-is",
  pwdGuide: "/guides/track-a-prevailing-wage-request",
  caseLookup: "/perm-case-status",
  processingTimes: "/perm-processing-times",
  methodology: "/methodology",
} as const;

const at = (path: string) => `${SITE_URL}${path}`;

/**
 * The links more than one email uses, worded once. Each starts with its page's
 * name in the site map (src/lib/siteMap.ts), as `alertNextSteps.test.ts` holds.
 */
export const NEXT_LINKS = {
  i140Wait: {
    href: at(NEXT_PATHS.i140Wait),
    text: "I-140 wait: how long USCIS takes, and the premium processing clock",
  },
  uscisLookup: {
    href: at(NEXT_PATHS.uscisLookup),
    text: "USCIS case status: look up a receipt number, and get an email when it changes",
  },
  planner: {
    href: at(NEXT_PATHS.planner),
    text: "Green card timeline and planner: every step dated from your own dates",
  },
  priorityDates: {
    href: at(NEXT_PATHS.priorityDates),
    text: "Priority date calculator: your date against every bulletin",
  },
  rfeDeadline: {
    href: at(NEXT_PATHS.rfeDeadline),
    text: "USCIS RFE response deadline: the day USCIS must receive your answer",
  },
  uscisTimes: {
    href: at(NEXT_PATHS.uscisTimes),
    text: "USCIS processing times: every form, from USCIS's own figures",
  },
} as const satisfies Record<string, NextLink>;

/** What follows a filing at USCIS: the receipt number, and the beta that watches it. */
function receiptSentence(filing: string): string {
  return `Once ${filing} is filed, USCIS sends a receipt number, and a beta on our USCIS page emails you when its status changes.`;
}

/**
 * The review stages with a page of their own on the site (`/perm-rfi-audit/<slug>`: every case waiting there, how
 * long, and every case that left with where it went). The site's list is `reviewStages()` in
 * `src/components/rfi/stageMeta.ts`, which Convex can't import; `alertNextSteps.test.ts` holds the two equal.
 */
const STAGE_PAGES: Record<string, string> = {
  "APPLICATION ON HOLD": "application-on-hold",
  "RFI ISSUED": "rfi-issued",
  "NORD ISSUED": "nord-issued",
  "SUPERVISED RECRUITMENT": "supervised-recruitment",
  "PENDING AUDIT RESPONSE": "pending-audit-response",
  "RECONSIDERATION APPEALS": "reconsideration-appeals",
  "BALCA APPEALS": "balca-appeals",
  "REQUEST FOR REVIEW": "request-for-review",
  "DENIED - BALCA DISMISSED": "denied-balca-dismissed",
};

/** The site path of a review stage's page, or null for a status without one. */
export function stagePagePath(status: string): string | null {
  const slug = STAGE_PAGES[status.trim().toUpperCase()];
  return slug ? `/perm-rfi-audit/${slug}` : null;
}

/** The visa bulletin's alert form, with the priority date shown beside it when we know it. */
export function bulletinAlertUrl(priorityDate?: string | null): string {
  const [path, hash] = NEXT_PATHS.bulletinAlert.split("#");
  const q = priorityDate && ISO_DAY.test(priorityDate) ? `?pd=${priorityDate}` : "";
  return `${SITE_URL}${path}${q}#${hash}`;
}

/**
 * A status first seen before this hour, Eastern, was decided the day before:
 * FLAG shows a new status the day DOL decides it and the morning sweep reads
 * it the next morning. Held equal to `SEEN_NEXT_MORNING_BEFORE_HOUR` in
 * src/lib/scorecard/score.ts by alertNextSteps.test.ts.
 */
export const SEEN_NEXT_MORNING_BEFORE_HOUR = 12;

const EASTERN_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_TIMEZONE, hour: "numeric", hourCycle: "h23" });

/**
 * The day DOL acted on a status we first saw at `seenMs`, "YYYY-MM-DD". In
 * the morning that's the day before, so a deadline counted from it can only
 * come out early, never late.
 */
export function dayDolActed(seenMs: number): string {
  const day = easternDay(seenMs);
  if (Number(EASTERN_HOUR.format(seenMs)) >= SEEN_NEXT_MORNING_BEFORE_HOUR) return day;
  return new Date(Date.parse(`${day}T12:00:00Z`) - MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The PERM filing day on DOL's record, "YYYY-MM-DD": DOL's own submitted
 * time (UTC) as an Eastern day, else the day the case number encodes.
 */
export function filingDayOnRecord(submitted: string | null | undefined, filingDate: string | null | undefined): string | null {
  const t = submitted ? Date.parse(submitted) : Number.NaN;
  if (Number.isFinite(t)) return easternDay(t);
  return filingDate && ISO_DAY.test(filingDate.slice(0, 10)) ? filingDate.slice(0, 10) : null;
}

/** The I-140's last day for a certification on `certifiedOn`, or null. */
export function i140DueBy(certifiedOn: string | null | undefined): string | null {
  if (!certifiedOn || !ISO_DAY.test(certifiedOn)) return null;
  const due = calculateETA9089Expiration(new Date(`${certifiedOn}T00:00:00Z`));
  return Number.isNaN(due.getTime()) ? null : due.toISOString().slice(0, 10);
}

/** The last day to ask DOL to look again at a denial dated `deniedOn` (the letter's date + 30), or null. */
export function denialReviewDueBy(deniedOn: string | null | undefined): string | null {
  if (!deniedOn || !ISO_DAY.test(deniedOn)) return null;
  const due = calculateDenialReviewDeadline(deniedOn);
  return ISO_DAY.test(due) ? due : null;
}

/** A PERM job's prevailing wage request (ETA-9141 for a green card), not an H-1B or E-3 one. */
export function isPermWageRequest(caseNumber: string): boolean {
  return /^P-100-/i.test(caseNumber.trim());
}

const LCA_VISA: Record<string, string> = {
  "I-200": "H-1B",
  "I-201": "H-1B1",
  "I-202": "H-1B1",
  "I-203": "E-3",
};

/** The priority date and the bulletin alert for it: a certified PERM's, and an approved I-140's. */
function priorityDateStep(body: string, priorityDate: string | null): NextStep {
  return {
    title: "Your priority date",
    body,
    link: { href: bulletinAlertUrl(priorityDate), text: "Email me when the bulletin moves" },
    button: true,
  };
}

/** The last stretch, for anyone whose next wait is the bulletin. */
const REST_OF_THE_WAY: NextStep = {
  title: "The rest of the way",
  body: "Once the bulletin reaches your date, the I-485 or a visa interview abroad comes next.",
  link: NEXT_LINKS.planner,
};

function permCertified(input: NextStepInput): NextSteps {
  const due = i140DueBy(input.certifiedOn);
  const pd = input.priorityDate && ISO_DAY.test(input.priorityDate) ? input.priorityDate : null;
  return {
    steps: [
      {
        title: "The I-140",
        body: due
          ? `The employer files it with USCIS within 180 days of the certification, so by about ${longDate(due)}. The exact last day is the expiration date DOL printed on the certification.`
          : "The employer files it with USCIS within 180 days of the certification. The exact last day is the expiration date DOL printed on the certification.",
        link: NEXT_LINKS.i140Wait,
      },
      {
        title: "The receipt number",
        body: receiptSentence("the I-140"),
        link: NEXT_LINKS.uscisLookup,
      },
      priorityDateStep(
        pd
          ? `It's ${longDate(pd)}, this case's PERM filing date on DOL's record, and the visa bulletin decides when it can be used.`
          : "It's this case's PERM filing date, and the visa bulletin decides when it can be used.",
        pd,
      ),
      REST_OF_THE_WAY,
    ],
    links: [
      { href: at(NEXT_PATHS.certifiedGuide), text: "What happens after a PERM is certified, step by step" },
      { href: at(NEXT_PATHS.greenCardLine), text: "Your place in line: everyone ahead of your priority date" },
      { href: at(NEXT_PATHS.shareTimeline), text: "Add your dates to the green card timelines as your case moves" },
    ],
  };
}

function permDenied(input: NextStepInput, status: string): NextSteps {
  if (status === "DENIED") {
    const due = denialReviewDueBy(input.deniedOn);
    return {
      steps: [
        {
          title: "The employer's options",
          body: due
            ? `It can ask DOL to reconsider, or ask DOL's appeals board to review the denial, by about ${longDate(due)}. The exact last day is 30 days from the date on the denial letter.`
            : "It can ask DOL to reconsider, or ask DOL's appeals board to review the denial, within 30 days of the date on the denial letter.",
          link: { href: at(NEXT_PATHS.appealGuide), text: "How reconsideration and the appeals board work" },
        },
        {
          title: "We're still watching",
          body: "If the employer asks, DOL's record moves to RECONSIDERATION APPEALS or BALCA APPEALS, and we'll email you when it does.",
          link: {
            href: at(stagePagePath("RECONSIDERATION APPEALS")!),
            text: "How long reconsideration is taking, from the cases we've followed",
          },
        },
      ],
      links: [{ href: at(NEXT_PATHS.denialGuide), text: "What a denial means, and the options after one" }],
    };
  }
  // The Board's decision (DENIED - BALCA AFFIRMED, DENIED - BALCA DISMISSED).
  return {
    steps: [
      {
        title: "The end of DOL's review",
        body: "The appeals board's decision is the last step at DOL, and the guide covers what can follow it, filing again included.",
        link: { href: at(NEXT_PATHS.denialGuide), text: "What a denial means, and the options after one" },
      },
    ],
    links: [],
  };
}

function pwdIssued(input: NextStepInput): NextSteps {
  if (!isPermWageRequest(input.caseNumber)) {
    return {
      steps: [
        {
          title: "The LCA",
          body: "This wage is for an H-1B, H-1B1 or E-3 job, so the next filing is usually the LCA, where the employer can use it as the prevailing wage.",
          link: { href: at(NEXT_PATHS.lcaGuide), text: "What an LCA is, and how to look one up" },
        },
      ],
      links: [],
    };
  }
  const who =
    input.employerName && input.jobTitle
      ? `If DOL's record shows a PERM application from ${input.employerName} for ${input.jobTitle}, we'll email you its case number.`
      : "If DOL's record shows a PERM application from the same employer for the same job, we'll email you its case number.";
  return {
    steps: [
      {
        title: "Recruitment, then the PERM application",
        body: "The employer has to start recruitment, or file the PERM application (the ETA-9089), while this wage is still valid. The PERM's filing date becomes your priority date.",
        link: { href: at(NEXT_PATHS.deadlineTool), text: "PERM deadlines: the recruitment and filing dates from this wage" },
      },
      {
        title: "We'll watch for the PERM",
        body: `${who} DOL's record doesn't name the worker, so we'll say it may be yours.`,
      },
    ],
    links: [
      { href: at(NEXT_PATHS.pwdValidity), text: "Wage determination validity: the day this wage expires" },
      { href: at(NEXT_PATHS.queueAlert), text: "Once the PERM is filed, an email when DOL's queue reaches its month" },
    ],
  };
}

function lcaCertified(caseNumber: string): NextSteps {
  const visa = LCA_VISA[caseNumber.trim().toUpperCase().slice(0, 5)] ?? "H-1B";
  const first: NextStep =
    visa === "H-1B"
      ? {
          title: "The H-1B petition",
          body: `The employer files it with USCIS on Form I-129, with this certified LCA. ${receiptSentence("the petition")}`,
          link: NEXT_LINKS.uscisLookup,
        }
      : {
          title: `The ${visa} visa`,
          body: "The certified LCA goes with the visa request: a petition to USCIS on Form I-129, or an application at a U.S. consulate abroad.",
        };
  return {
    steps: [
      first,
      {
        title: "If a green card comes later",
        body: "Its first DOL step is a prevailing wage request, and you can watch that one here too, by its P- number.",
        link: { href: at(NEXT_PATHS.pwdGuide), text: "If a green card follows: watching its wage request" },
      },
    ],
    // The rating page shows these links without the steps above them, so each says what it's for on its own.
    links:
      visa === "H-1B"
        ? [{ href: at(NEXT_PATHS.i129Times), text: "How long USCIS takes with an H-1B petition (Form I-129)" }]
        : [NEXT_LINKS.uscisLookup],
  };
}

/**
 * The next step after a final status, or null when there is nothing honest to
 * add (a withdrawal, an expiry, a seasonal filing, any status still pending).
 */
export function nextStepsFor(input: NextStepInput): NextSteps | null {
  if (!input.isFinal) return null;
  const status = input.status.trim().toUpperCase();
  if (input.program === "perm") {
    if (status === "CERTIFIED") return permCertified(input);
    if (status.startsWith("DENIED")) return permDenied(input, status);
    return null;
  }
  if (input.program === "pwd" && input.approved) return pwdIssued(input);
  if (input.program === "lca" && status === "CERTIFIED") return lcaCertified(input.caseNumber);
  return null;
}

/** Every link a block carries, in its order: each step's, then the further reading. */
export function allLinks(next: NextSteps | null): NextLink[] {
  if (!next) return [];
  return [...next.steps.flatMap((s) => (s.link ? [s.link] : [])), ...next.links];
}

/**
 * The same steps for the owner of a saved case: the bulletin alert is the
 * case's own switch on its Green card tab (convex/caseBulletinAlert.ts), which
 * reads the line from the case's category and chargeability, never the public
 * form.
 */
export function forSavedCase(next: NextSteps | null, caseUrl: string): NextSteps | null {
  if (!next) return null;
  const bulletinForm = `${SITE_URL}${NEXT_PATHS.bulletinAlert.split("#")[0]}`;
  return {
    ...next,
    steps: next.steps.map((s) =>
      s.link && s.link.href.startsWith(bulletinForm)
        ? { ...s, link: { href: `${caseUrl}?tab=greenCard`, text: "Turn on this case's bulletin alert" } }
        : s,
    ),
  };
}

/**
 * The "Also on PERM Tracker" links, after the employer's own page (which the
 * template adds when it shows the employer's record). DOL's PERM queue is
 * named only to someone still waiting in it: a decided case, an LCA or a
 * seasonal filing has nothing to read there.
 */
export function alsoLinksFor(input: Pick<NextStepInput, "program" | "status" | "isFinal">): NextLink[] {
  const status = input.status.trim().toUpperCase();
  const out: NextLink[] = [];
  const stagePage = input.program === "perm" ? stagePagePath(status) : null;
  if (stagePage) {
    out.push({ href: at(stagePage), text: "How long cases wait at this status, and where the ones that left went" });
  }
  if (input.program === "perm" && status === "RFI ISSUED") {
    out.push({ href: at(NEXT_PATHS.rfiSteps), text: "What happens after an RFI, step by step, from the ones we've followed" });
  }
  if (!input.isFinal && input.program === "perm") {
    out.push({ href: at(NEXT_PATHS.processingTimes), text: "The filing month DOL's queue has reached" });
  }
  if (!input.isFinal && input.program === "pwd") {
    out.push({ href: at(NEXT_PATHS.processingTimes), text: "The month DOL's wage-request queue has reached" });
  }
  out.push({ href: at(NEXT_PATHS.methodology), text: "Where every figure in this email comes from" });
  return out;
}

/** The plain-text part's lines for a next-steps block: each step, then its link. */
export function nextStepsText(next: NextSteps | null): string[] {
  if (!next) return [];
  return [
    "What comes next:",
    ...next.steps.flatMap((s) => [`  ${s.title}. ${s.body}`, ...(s.link ? [`  ${s.link.text}: ${s.link.href}`] : [])]),
    ...next.links.map((l) => `  ${l.text}: ${l.href}`),
    "",
  ];
}

// ============================================================================
// After a USCIS receipt moves, and after the bulletin moves
// ============================================================================

/**
 * The forms with a processing-time page of their own (`/uscis-processing-times/<form lowercased>`). The site's list
 * is `FORM_PAGES` in src/lib/uscisForms.ts, which Convex can't import; `alertNextSteps.test.ts` holds the two equal.
 */
export const USCIS_FORMS_WITH_PAGES: readonly string[] = [
  "I-140",
  "I-485",
  "I-765",
  "I-131",
  "I-129",
  "I-539",
  "I-130",
  "I-360",
  "I-526",
  "I-824",
  "I-290B",
  "I-751",
  "I-90",
  "I-129F",
  "N-400",
];

/** The form a USCIS receipt is for, as its page names it ("I-485"), or null. */
function formOf(form: string | null): string | null {
  const m = /^\s*([IN])-?(\d+[A-Z]?)\b/i.exec(form ?? "");
  return m ? `${m[1]!.toUpperCase()}-${m[2]!.toUpperCase()}` : null;
}

/** What a receipt alert knows about one receipt: the form, and the tone and finality its status group gives. */
export interface ReceiptMove {
  form: string | null;
  tone: "good" | "bad" | "neutral";
  isFinal: boolean;
}

/** Forms whose approval is a card or document USCIS mails: the green card, the work permit, the travel document, a
 * replacement green card, the citizenship certificate. */
const CARD_FORMS: readonly string[] = ["I-485", "I-765", "I-131", "I-90", "N-600"];

function receiptSteps(r: ReceiptMove): NextStep[] {
  const form = formOf(r.form);
  // A request for evidence is the one status that's bad news and not final (convex/lib/uscisWatch.ts, groupTone).
  if (r.tone === "bad" && !r.isFinal) {
    return [
      {
        title: "The answer to USCIS",
        body: "The request for evidence gives the day USCIS must receive the answer.",
        link: NEXT_LINKS.rfeDeadline,
      },
    ];
  }
  if (r.tone === "good" && r.isFinal && form === "I-140") {
    return [
      priorityDateStep("The visa bulletin decides when the I-140's priority date can be used.", null),
      REST_OF_THE_WAY,
    ];
  }
  // An approval whose card or document comes in the mail (Nov 26 2026: an approved I-485 used to end with nothing):
  // the card's own statuses, and for a green card, what happens to the papers filed with it and the timeline.
  if (r.tone === "good" && r.isFinal && form && CARD_FORMS.includes(form)) {
    const mail: NextStep = {
      title: form === "I-485" ? "Your green card in the mail" : "Your card or document in the mail",
      body: "USCIS mails it to the address on the case. This receipt stays watched, so you'll hear when it's mailed and delivered.",
      link: { href: at(NEXT_PATHS.uscisStatuses), text: "What each USCIS status means, the card's too" },
    };
    if (form !== "I-485") return [mail];
    return [
      mail,
      {
        title: "Your work permit and travel document",
        body: "One still pending when the green card is approved is often closed, because the card replaces it.",
      },
      {
        title: "Your timeline",
        body: "Your dates help people at your office see how long each step takes. It's anonymous and takes a minute.",
        link: { href: at(NEXT_PATHS.shareTimeline), text: "Add your dates to the green card timelines" },
      },
    ];
  }
  if (r.isFinal) return [];
  if (form === "I-140") {
    return [{ title: "How long the I-140 takes", body: "USCIS publishes its own figures, and premium processing runs on a clock of its own.", link: NEXT_LINKS.i140Wait }];
  }
  if (form && USCIS_FORMS_WITH_PAGES.includes(form)) {
    return [
      {
        title: `How long the ${form} takes`,
        body: "USCIS publishes how long it takes to decide one, quarter by quarter.",
        link: { href: at(`${NEXT_PATHS.uscisTimes}/${form.toLowerCase()}`), text: `${form} processing time: USCIS's own figures` },
      },
    ];
  }
  return [{ title: "How long it takes", body: "USCIS publishes how long each form takes to decide.", link: NEXT_LINKS.uscisTimes }];
}

/**
 * What comes next after one or more receipts moved, or null when nothing honest follows (a denial, a withdrawal, an
 * approval of anything but an I-140). Several receipts share one block: a step already named isn't named twice.
 */
export function receiptNextSteps(moves: readonly ReceiptMove[]): NextSteps | null {
  const steps: NextStep[] = [];
  for (const s of moves.flatMap(receiptSteps)) {
    if (!steps.some((t) => t.title === s.title)) steps.push(s);
  }
  return steps.length > 0 ? { steps, links: [] } : null;
}

/** After a bulletin moved: read your own date against it, then what follows once it's reached. */
export function bulletinNextSteps(): NextSteps {
  return {
    steps: [
      {
        title: "Your own date",
        body: "Read your priority date against the new cutoff, and against every bulletin since October 2014.",
        link: NEXT_LINKS.priorityDates,
      },
      REST_OF_THE_WAY,
    ],
    links: [],
  };
}

// ============================================================================
// The confirmation pages: the next alert in the chain
// ============================================================================

export interface ConfirmOffer {
  href: string;
  /** The link text. */
  label: string;
  /** One sentence under it. */
  detail: string;
}

const QUEUE_OFFER: ConfirmOffer = {
  href: at(NEXT_PATHS.queueAlert),
  label: "An email when DOL's queue reaches a filing month",
  detail: "One email, the day DOL's analyst-review queue gets to the month a PERM was filed.",
};

const CASE_OFFER: ConfirmOffer = {
  href: at(NEXT_PATHS.caseLookup),
  label: "Alerts on the case itself, by its case number",
  detail: "Look the case up, then choose Email me changes. Every move DOL records, as it happens.",
};

const BULLETIN_OFFER: ConfirmOffer = {
  href: `${SITE_URL}${NEXT_PATHS.bulletinAlert}`,
  label: "After the PERM is certified, an email when the visa bulletin moves",
  detail: "When a new bulletin changes the cutoff for your category and country, and not otherwise.",
};

const RECEIPT_OFFER: ConfirmOffer = {
  href: at(NEXT_PATHS.uscisLookup),
  label: "After the I-140 is filed, an email when USCIS changes its status",
  detail: "Type the receipt number on the USCIS case status page, then add your email under the answer. It's a beta.",
};

/**
 * What a confirmation page offers next. Links only: turning anything on still
 * goes through its own form and its own confirmation email.
 */
export function confirmOffers(
  kind: "case" | "queue" | "bulletin" | "employer" | "uscis" | "block",
  caseNumbers: readonly string[] = [],
  programOf?: (caseNumber: string) => FlagProgram,
): ConfirmOffer[] {
  if (kind === "queue") return [CASE_OFFER, BULLETIN_OFFER];
  if (kind === "employer") return [CASE_OFFER];
  // A bulletin line is watched after the PERM: its receipts are the I-140's and the I-485's.
  if (kind === "bulletin") return [{ ...RECEIPT_OFFER, label: "An email when USCIS changes the status of your I-140 or I-485" }];
  // A receipt is watched after the PERM too: what's left is the bulletin reaching the priority date.
  if (kind === "uscis") return [{ ...BULLETIN_OFFER, label: "An email when the visa bulletin moves for your category and country" }];
  // A block is followed by someone whose case is already at USCIS: their own receipt is next, never the PERM.
  if (kind === "block") return [{ ...RECEIPT_OFFER, label: "An email when USCIS changes the status of your own case" }];
  const programs = new Set(caseNumbers.map((n) => (programOf ? programOf(n) : "perm")));
  const offers: ConfirmOffer[] = [];
  if (programs.has("perm")) offers.push(QUEUE_OFFER, RECEIPT_OFFER);
  if (caseNumbers.some(isPermWageRequest)) {
    offers.push({
      ...QUEUE_OFFER,
      label: "Once the PERM is filed, an email when DOL's queue reaches its month",
    });
  }
  // One link per destination, whichever program asked for it first.
  return offers.filter((o, i) => offers.findIndex((p) => p.href === o.href) === i);
}

/** The sentence a wage-request confirmation adds about the PERM it watches for. */
export const PWD_MATCH_SENTENCE =
  "When DOL issues the wage for a PERM job, we'll also look for the PERM application that follows it, and email you if one from the same employer for the same job shows up.";
