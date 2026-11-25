import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { decidedOnFromSeen, SEEN_NEXT_MORNING_BEFORE_HOUR as SCORE_HOUR } from "@/lib/scorecard/score";
import { programOf } from "@/lib/flagCaseNumber";
import { FORM_PAGES } from "@/lib/uscisForms";
import { SECTIONS } from "@/lib/siteMap";
import { reviewStages } from "@/components/rfi/stageMeta";
import {
  allLinks,
  alsoLinksFor,
  bulletinAlertUrl,
  bulletinNextSteps,
  confirmOffers,
  dayDolActed,
  denialReviewDueBy,
  filingDayOnRecord,
  forSavedCase,
  i140DueBy,
  NEXT_LINKS,
  NEXT_PATHS,
  nextStepsFor,
  nextStepsText,
  PWD_MATCH_SENTENCE,
  receiptNextSteps,
  SEEN_NEXT_MORNING_BEFORE_HOUR,
  type NextLink,
  type NextStepInput,
  type NextSteps,
  stagePagePath,
  USCIS_FORMS_WITH_PAGES,
} from "@convex/lib/alertNextSteps";
import { sitePageFor } from "../../../test-utils/sitePages";
import { ETA9089_EXPIRATION_DAYS } from "@convex/lib/perm/constants";

/**
 * The "what comes next" block on final case alerts and the offers on the
 * confirmation pages (convex/lib/alertNextSteps.ts): every link goes to a page
 * that exists, no deadline is typed, and a wage request for an H-1B job is
 * never told about a PERM.
 */


/** The file a public path is served from, route groups included (test-utils/sitePages.ts). */
const pageFor = sitePageFor;

const base: NextStepInput = {
  program: "perm",
  caseNumber: "G-100-26070-123456",
  status: "CERTIFIED",
  isFinal: true,
  approved: true,
  priorityDate: "2026-03-11",
  certifiedOn: "2026-10-15",
  employerName: "Example Systems, Inc.",
  jobTitle: "Software Engineer",
};

function words(n: ReturnType<typeof nextStepsFor>): string {
  return n ? nextStepsText(n).join("\n") : "";
}

describe("what comes next after a case alert", () => {
  it("links only to pages that exist, and to anchors those pages carry", () => {
    for (const path of Object.values(NEXT_PATHS)) {
      expect(pageFor(path), path).not.toBeNull();
    }
    const anchors: Array<[string, string]> = [
      [NEXT_PATHS.bulletinAlert, 'id="bulletin-alert"'],
      [NEXT_PATHS.queueAlert, 'id="queue-alert"'],
      [NEXT_PATHS.rfiSteps, 'id="step-by-step"'],
      [NEXT_PATHS.shareTimeline, 'id="add-h"'],
    ];
    for (const [path, id] of anchors) {
      expect(readFileSync(pageFor(path)!, "utf8"), `${path} carries ${id}`).toContain(id);
    }
  });

  it("dates the I-140 from the central calculator, never a typed number", () => {
    expect(ETA9089_EXPIRATION_DAYS).toBe(179);
    expect(i140DueBy("2026-10-15")).toBe("2027-04-12");
    expect(i140DueBy("not a date")).toBeNull();
    const text = words(nextStepsFor(base));
    expect(text).toContain("so by about April 12, 2027");
    expect(text).toContain("the expiration date DOL printed on the certification");
  });

  it("puts the I-140 first, then its receipt, then the bulletin, then the rest of the way", () => {
    const next = nextStepsFor(base)!;
    expect(next.steps.map((s) => s.title)).toEqual(["The I-140", "The receipt number", "Your priority date", "The rest of the way"]);
    expect(next.steps.map((s) => s.link?.href)).toEqual([
      "https://permtracker.app/tools/i140-calculator",
      "https://permtracker.app/uscis-case-status",
      "https://permtracker.app/visa-bulletin?pd=2026-03-11#bulletin-alert",
      "https://permtracker.app/tools/green-card-timeline",
    ]);
    // One button: the onward alert.
    expect(next.steps.filter((s) => s.button).map((s) => s.title)).toEqual(["Your priority date"]);
  });

  it("names the priority date from DOL's record and offers the bulletin alert for it", () => {
    const next = nextStepsFor(base)!;
    expect(words(next)).toContain("March 11, 2026");
    expect(next.steps.find((s) => s.button)?.link?.href).toBe("https://permtracker.app/visa-bulletin?pd=2026-03-11#bulletin-alert");
    expect(bulletinAlertUrl("2026-3-1")).toBe("https://permtracker.app/visa-bulletin#bulletin-alert");
    const hrefs = next.links.map((l) => l.href);
    expect(hrefs[0]).toBe("https://permtracker.app/guides/perm-certified-what-next");
    expect(hrefs).toContain("https://permtracker.app/tools/green-card-line");
    // USCIS's I-140 figures are on the I-140 wait page, the first step's link.
    expect(allLinks(next).map((l) => l.href)).toContain("https://permtracker.app/tools/i140-calculator");
  });

  it("still says what's next without the certification day or the filing day", () => {
    const text = words(nextStepsFor({ ...base, certifiedOn: null, priorityDate: null }));
    expect(text).not.toContain("about");
    expect(text).toContain("within 180 days of the certification.");
    expect(text).toContain("It's this case's PERM filing date, and the visa bulletin decides when it can be used.");
  });

  it("gives a denial its two 30-day options and says we keep watching", () => {
    const text = words(nextStepsFor({ ...base, status: "DENIED", approved: false }));
    expect(text).toContain("30 days");
    expect(text).not.toContain("about");
    expect(text).toContain("RECONSIDERATION APPEALS or BALCA APPEALS");
    expect(text).toContain("/guides/perm-denied-what-happens-next");
    expect(text).toContain("/guides/perm-appeal-reconsideration-balca");
    const board = words(nextStepsFor({ ...base, status: "DENIED - BALCA AFFIRMED", approved: false }));
    expect(board).toContain("last step at DOL");
    expect(board).not.toContain("30 days");
  });

  it("dates a denial's 30 days from the central calculator, from the day DOL's record moved", () => {
    expect(denialReviewDueBy("2026-10-15")).toBe("2026-11-14");
    expect(denialReviewDueBy("not a date")).toBeNull();
    const text = words(nextStepsFor({ ...base, status: "DENIED", approved: false, deniedOn: "2026-10-15" }));
    expect(text).toContain("by about November 14, 2026");
    expect(text).toContain("30 days from the date on the denial letter");
    // A certification day never dates a denial, nor a denial day a certification.
    expect(words(nextStepsFor({ ...base, status: "DENIED", approved: false, certifiedOn: "2026-10-15" }))).not.toContain("about");
    expect(words(nextStepsFor({ ...base, certifiedOn: null, deniedOn: "2026-10-15" }))).not.toContain("about");
  });

  it("tells a PERM job's wage request about recruitment, the PERM and the match", () => {
    const pwd = { ...base, program: "pwd" as const, caseNumber: "P-100-26118-846661", status: "DETERMINATION ISSUED" };
    const text = words(nextStepsFor(pwd));
    expect(text).toContain("start recruitment, or file the PERM application");
    expect(text).toContain("a PERM application from Example Systems, Inc. for Software Engineer");
    expect(text).toContain("may be yours");
    expect(text).toContain("/tools/perm-deadline-calculator");
    expect(text).toContain("/tools/perm-timeline-calculator#queue-alert");
  });

  it("never tells an H-1B or E-3 job's wage request about a PERM", () => {
    for (const caseNumber of ["P-200-26118-846661", "P-203-26118-846661"]) {
      const text = words(nextStepsFor({ ...base, program: "pwd", caseNumber, status: "DETERMINATION ISSUED" }));
      expect(text).toContain("the LCA");
      expect(text).not.toContain("PERM");
    }
  });

  it("points a certified LCA at the visa filing, and is honest about the USCIS page", () => {
    const h1b = words(nextStepsFor({ ...base, program: "lca", caseNumber: "I-200-26118-846661" }));
    expect(h1b).toContain("Form I-129");
    // The beta emails a status change; the lookup itself isn't promised to show the status.
    expect(h1b).toContain("Once the petition is filed, USCIS sends a receipt number, and a beta on our USCIS page emails you");
    expect(h1b).not.toMatch(/shows? (you )?(its|the) status/);
    expect(h1b).toContain("prevailing wage request");
    const e3 = words(nextStepsFor({ ...base, program: "lca", caseNumber: "I-203-26118-846661" }));
    expect(e3).toContain("The E-3 visa");
  });

  it("gives a certified H-1B LCA links that stand alone, as the rating page shows them without their steps", () => {
    const links = (caseNumber: string) => allLinks(nextStepsFor({ ...base, program: "lca", caseNumber }));
    const h1b = links("I-200-26118-846661");
    expect(h1b.map((l) => l.href)).toContain(`https://permtracker.app${NEXT_PATHS.i129Times}`);
    expect(h1b.find((l) => l.href.endsWith(NEXT_PATHS.pwdGuide))?.text).toMatch(/green card/i);
    // An E-3 or H-1B1 may go through a consulate, so it isn't sent to USCIS's I-129 times.
    expect(links("I-203-26118-846661").map((l) => l.href)).not.toContain(`https://permtracker.app${NEXT_PATHS.i129Times}`);
  });

  it("adds nothing it can't stand behind", () => {
    expect(nextStepsFor({ ...base, status: "WITHDRAWN", approved: false })).toBeNull();
    expect(nextStepsFor({ ...base, status: "RFI ISSUED", isFinal: false, approved: false })).toBeNull();
    expect(
      nextStepsFor({ ...base, program: "seasonal", caseNumber: "H-300-26118-846661", status: "FULL CERTIFICATION" }),
    ).toBeNull();
    expect(
      nextStepsFor({ ...base, program: "lca", caseNumber: "I-200-26118-846661", status: "WITHDRAWN", approved: false }),
    ).toBeNull();
  });

  it("names DOL's PERM queue only to someone still waiting in it", () => {
    const queue = "https://permtracker.app/perm-processing-times";
    const hrefs = (i: Parameters<typeof alsoLinksFor>[0]) => alsoLinksFor(i).map((l) => l.href);
    expect(hrefs({ program: "perm", status: "ANALYST REVIEW", isFinal: false })).toContain(queue);
    expect(hrefs({ program: "perm", status: "CERTIFIED", isFinal: true })).not.toContain(queue);
    expect(hrefs({ program: "pwd", status: "DETERMINATION ISSUED", isFinal: true })).not.toContain(queue);
    expect(hrefs({ program: "lca", status: "IN PROCESS", isFinal: false })).not.toContain(queue);
    expect(hrefs({ program: "pwd", status: "IN PROCESS", isFinal: false })).toContain(queue);
    expect(hrefs({ program: "lca", status: "CERTIFIED", isFinal: true })).toEqual(["https://permtracker.app/methodology"]);
    // An RFI names its own stage page first (every open RFI, how long, where they went), then the step-by-step path.
    const rfi = hrefs({ program: "perm", status: "RFI ISSUED", isFinal: false });
    expect(rfi[0]).toBe("https://permtracker.app/perm-rfi-audit/rfi-issued");
    expect(rfi).toContain("https://permtracker.app/perm-rfi-audit#step-by-step");
  });

  it("counts from the day DOL acted, by the scorecard's own rule", () => {
    expect(SEEN_NEXT_MORNING_BEFORE_HOUR).toBe(SCORE_HOUR);
    for (const at of ["2026-10-16T11:05:00Z", "2026-10-16T18:30:00Z", "2026-11-02T04:30:00Z", "2026-03-08T16:59:00Z"]) {
      expect(dayDolActed(Date.parse(at)), at).toBe(decidedOnFromSeen(Date.parse(at)));
    }
    // 7:05 AM EDT is read as the day before; it can only move a deadline earlier.
    expect(dayDolActed(Date.parse("2026-10-16T11:05:00Z"))).toBe("2026-10-15");
  });

  it("reads the filing day DOL recorded, as an Eastern date", () => {
    expect(filingDayOnRecord("2026-10-16T02:30:00.10Z", "2026-10-16")).toBe("2026-10-15");
    expect(filingDayOnRecord(null, "2026-10-16")).toBe("2026-10-16");
    expect(filingDayOnRecord("garbage", "nope")).toBeNull();
  });

  it("offers the next alert in the chain on each confirmation page", () => {
    const perm = confirmOffers("case", ["G-100-26070-123456"], programOf);
    expect(perm.map((o) => o.href)).toEqual([
      "https://permtracker.app/tools/perm-timeline-calculator#queue-alert",
      "https://permtracker.app/uscis-case-status",
    ]);
    expect(confirmOffers("case", ["P-100-26118-846661"], programOf)[0]?.label).toContain("Once the PERM is filed");
    expect(confirmOffers("case", ["I-200-26118-846661"], programOf)).toEqual([]);
    expect(confirmOffers("case", ["P-200-26118-846661"], programOf)).toEqual([]);
    expect(confirmOffers("queue").map((o) => o.href)).toEqual([
      "https://permtracker.app/perm-case-status",
      "https://permtracker.app/visa-bulletin#bulletin-alert",
    ]);
    expect(confirmOffers("employer")).toHaveLength(1);
    // After the bulletin, the receipts; after a receipt, the bulletin.
    expect(confirmOffers("bulletin").map((o) => o.href)).toEqual(["https://permtracker.app/uscis-case-status"]);
    expect(confirmOffers("uscis").map((o) => o.href)).toEqual(["https://permtracker.app/visa-bulletin#bulletin-alert"]);
    expect(confirmOffers("uscis")[0]?.label).not.toContain("After the PERM");
    // Two programs asking for the same page get one link.
    expect(confirmOffers("case", ["G-100-26070-123456", "P-100-26118-846661"], programOf)).toHaveLength(2);
  });

  it("speaks in the house voice", () => {
    const all = [
      words(nextStepsFor(base)),
      words(nextStepsFor({ ...base, status: "DENIED", approved: false })),
      words(nextStepsFor({ ...base, program: "pwd", caseNumber: "P-100-26118-846661", status: "DETERMINATION ISSUED" })),
      words(nextStepsFor({ ...base, program: "lca", caseNumber: "I-200-26118-846661" })),
      words(nextStepsFor({ ...base, status: "DENIED", approved: false, deniedOn: "2026-10-15" })),
      words(receiptNextSteps(RECEIPTS)),
      words(bulletinNextSteps()),
      ...(["case", "queue", "bulletin", "uscis", "employer"] as const).flatMap((k) =>
        confirmOffers(k, ["G-100-26070-123456"], programOf).flatMap((o) => [o.label, o.detail]),
      ),
      PWD_MATCH_SENTENCE,
    ].join("\n");
    expect(all).not.toMatch(/—|!/);
    expect(all).not.toMatch(/\bwill be approved\b|\bguarantee/i);
    // The receipt alert is a beta, never priced (the USCIS tracking's standing rule: no price, never paid or free).
    expect(all).toContain("beta");
    expect(all).not.toMatch(/\bfree\b|\bpaid\b|\$\d/i);
  });
});

describe("the review stages in a case alert", () => {
  it("names the page of every stage that has one, and no other", () => {
    for (const s of reviewStages()) expect(stagePagePath(s.status), s.status).toBe(`/perm-rfi-audit/${s.slug}`);
    for (const s of ["ANALYST REVIEW", "CERTIFIED", "DENIED", "RECONSIDERATION APPEALS - RFI ISSUED", "WITHDRAWN"]) {
      expect(stagePagePath(s), s).toBeNull();
    }
  });

  it("links a case at a review stage to how long cases wait there", () => {
    const hrefs = alsoLinksFor({ program: "perm", status: "RECONSIDERATION APPEALS", isFinal: false }).map((l) => l.href);
    expect(hrefs).toContain("https://permtracker.app/perm-rfi-audit/reconsideration-appeals");
    const rfi = alsoLinksFor({ program: "perm", status: "RFI ISSUED", isFinal: false }).map((l) => l.href);
    expect(rfi).toContain("https://permtracker.app/perm-rfi-audit/rfi-issued");
    // Only a PERM case: an LCA or a wage request has no review stages.
    expect(alsoLinksFor({ program: "lca", status: "RFI ISSUED", isFinal: false }).map((l) => l.href).join(" ")).not.toContain("/perm-rfi-audit/");
  });

  it("points a denial at how long reconsideration is taking, and a certification at sharing a timeline", () => {
    const denied = words(nextStepsFor({ ...base, status: "DENIED", approved: false }));
    expect(denied).toContain("https://permtracker.app/perm-rfi-audit/reconsideration-appeals");
    const certified = words(nextStepsFor(base));
    expect(certified).toContain("https://permtracker.app/green-card-timelines#add-h");
  });
});

/** One receipt per path the receipt alert's next steps can take. */
const RECEIPTS = [
  { form: "I-485", tone: "neutral" as const, isFinal: false },
  { form: "I-140", tone: "bad" as const, isFinal: false },
  { form: "I-140", tone: "good" as const, isFinal: true },
];

describe("what comes next after a USCIS receipt moves", () => {
  const one = (form: string | null, tone: "good" | "bad" | "neutral", isFinal: boolean) =>
    receiptNextSteps([{ form, tone, isFinal }]);

  it("a receipt still waiting gets its form's processing time, by the page's own name", () => {
    const i485 = one("I-485", "neutral", false)!;
    expect(i485.steps[0]?.link).toEqual({
      href: "https://permtracker.app/uscis-processing-times/i-485",
      text: "I-485 processing time: USCIS's own figures",
    });
    expect(one("I-140", "neutral", false)!.steps[0]?.link?.href).toBe("https://permtracker.app/tools/i140-calculator");
    // A form with no page of its own gets the index, and an unreadable one too.
    expect(one("I-9999", "neutral", false)!.steps[0]?.link?.href).toBe("https://permtracker.app/uscis-processing-times");
    expect(one(null, "neutral", false)!.steps[0]?.link?.href).toBe("https://permtracker.app/uscis-processing-times");
    // USCIS's own spelling of the form reads the same.
    expect(one("I-765 Application for Employment Authorization", "neutral", false)!.steps[0]?.link?.href).toBe(
      "https://permtracker.app/uscis-processing-times/i-765",
    );
  });

  it("a request for evidence gets the response deadline", () => {
    expect(one("I-140", "bad", false)!.steps[0]?.link?.href).toBe("https://permtracker.app/tools/rfe-response-deadline");
  });

  it("an approved I-140 goes on to the bulletin alert and the planner", () => {
    const next = one("I-140", "good", true)!;
    expect(next.steps.find((s) => s.button)?.link?.href).toBe("https://permtracker.app/visa-bulletin#bulletin-alert");
    expect(allLinks(next).map((l) => l.href)).toContain("https://permtracker.app/tools/green-card-timeline");
  });

  it("adds nothing after a denial, a withdrawal or another form's approval", () => {
    expect(one("I-140", "bad", true)).toBeNull();
    expect(one("I-485", "neutral", true)).toBeNull();
    expect(one("I-485", "good", true)).toBeNull();
  });

  it("names a step once when several receipts share it", () => {
    const next = receiptNextSteps([
      { form: "I-485", tone: "neutral", isFinal: false },
      { form: "I-485", tone: "neutral", isFinal: false },
      { form: "I-765", tone: "neutral", isFinal: false },
    ])!;
    expect(next.steps.map((s) => s.title)).toEqual(["How long the I-485 takes", "How long the I-765 takes"]);
  });

  it("knows every form the site has a processing-time page for, and no other", () => {
    expect([...USCIS_FORMS_WITH_PAGES].sort()).toEqual(FORM_PAGES.map((p) => p.form).sort());
    for (const p of FORM_PAGES) expect(p.slug).toBe(p.form.toLowerCase());
  });
});

describe("what comes next after the bulletin moves", () => {
  it("reads your own date first, then the planner", () => {
    expect(bulletinNextSteps().steps.map((s) => s.link?.href)).toEqual([
      "https://permtracker.app/tools/priority-date-calculator",
      "https://permtracker.app/tools/green-card-timeline",
    ]);
  });
});

describe("a saved case's own bulletin alert", () => {
  it("points the bulletin step at the case's Green card tab and leaves the rest alone", () => {
    const caseUrl = "https://permtracker.app/cases/abc123";
    const public_ = nextStepsFor(base)!;
    const saved = forSavedCase(public_, caseUrl)!;
    const bulletin = saved.steps.find((s) => s.button)!;
    expect(bulletin.link?.href).toBe(`${caseUrl}?tab=greenCard`);
    expect(saved.steps.filter((s) => !s.button)).toEqual(public_.steps.filter((s) => !s.button));
    expect(saved.links).toEqual(public_.links);
    expect(forSavedCase(null, caseUrl)).toBeNull();
  });
});

describe("a link names its page the way the site does", () => {
  /** The site map's one name for a path, or null for a page it doesn't list. */
  const nameOf = (href: string): string | null => {
    const path = new URL(href).pathname;
    return SECTIONS.find((sec) => sec.href === path)?.name ?? null;
  };
  const blocks: Array<NextSteps | null> = [
    nextStepsFor(base),
    nextStepsFor({ ...base, status: "DENIED", approved: false }),
    nextStepsFor({ ...base, program: "pwd", caseNumber: "P-100-26118-846661", status: "DETERMINATION ISSUED" }),
    nextStepsFor({ ...base, program: "lca", caseNumber: "I-200-26118-846661" }),
    nextStepsFor({ ...base, program: "lca", caseNumber: "I-203-26118-846661" }),
    receiptNextSteps(RECEIPTS),
    bulletinNextSteps(),
  ];
  const links: NextLink[] = [...Object.values(NEXT_LINKS), ...blocks.flatMap(allLinks)];

  it("starts every link to a site-map page with that page's name", () => {
    const named = links.filter((l) => nameOf(l.href) && !l.href.includes("#"));
    expect(named.length).toBeGreaterThan(5);
    for (const l of named) expect(l.text.startsWith(`${nameOf(l.href)}:`), `${l.text} names ${nameOf(l.href)}`).toBe(true);
  });

  it("goes only to pages that exist", () => {
    for (const l of links) {
      const url = new URL(l.href);
      expect(url.origin, l.href).toBe("https://permtracker.app");
      expect(pageFor(url.pathname), l.href).not.toBeNull();
    }
  });
});
