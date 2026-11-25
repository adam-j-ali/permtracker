// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "react-email";

import { alsoLinksFor, forSavedCase, nextStepsFor } from "@convex/lib/alertNextSteps";
import { CaseStatusChanged, type CaseStatusChangedProps } from "../CaseStatusChanged";
import { PossiblePermMatch } from "../PossiblePermMatch";
import { StatusChange } from "../StatusChange";

/**
 * The "what comes next" block in the final case alerts, as rendered, and the
 * possible-PERM email's wording. The block's content is tested in
 * src/lib/__tests__/alertNextSteps.test.ts; this holds what reaches an inbox.
 */

/** The rendered email with each kept-whole form name back in its sentence (EmailKeepWhole's no-wrap spans). */
async function renderFlat(email: Parameters<typeof render>[0]): Promise<string> {
  return (await render(email)).replace(/<span style="white-space:nowrap">([^<]*)<\/span>/g, "$1");
}

const base: CaseStatusChangedProps = {
  caseNumber: "G-100-26070-123456",
  employerName: "Example Systems, Inc.",
  jobTitle: "Software Engineer",
  fromStatus: "ANALYST REVIEW",
  toStatus: "CERTIFIED",
  tone: "live",
  meaning: null,
  isFinal: true,
  observedAt: "October 15, 2026",
  contextRows: [{ label: "Cases now at this status", value: "906" }],
  contextProvenance: "Counted from DOL's own case status, checked daily.",
  caseUrl: "https://permtracker.app/perm-case-status?case=G-100-26070-123456",
  unsubscribeUrl: "https://permtracker.app/case-alert/unsubscribe?token=U",
};

describe("what comes next, in the email", () => {
  it("puts the I-140 day, the priority date and the bulletin alert in a certified PERM's email", async () => {
    const input = {
      program: "perm" as const,
      caseNumber: base.caseNumber,
      status: "CERTIFIED",
      isFinal: true,
      approved: true,
      priorityDate: "2026-03-11",
      certifiedOn: "2026-10-15",
    };
    const html = await renderFlat(
      CaseStatusChanged({ ...base, next: nextStepsFor(input), alsoLinks: alsoLinksFor(input) }),
    );
    expect(html).toContain("What comes next");
    expect(html).toContain("April 12, 2027");
    expect(html).toContain("March 11, 2026");
    expect(html).toContain("https://permtracker.app/visa-bulletin?pd=2026-03-11#bulletin-alert");
    expect(html).not.toContain("https://permtracker.app/perm-processing-times");
  });

  it("gives each step its link right under it, the I-140 first", async () => {
    const input = {
      program: "perm" as const,
      caseNumber: base.caseNumber,
      status: "CERTIFIED",
      isFinal: true,
      approved: true,
      priorityDate: "2026-03-11",
      certifiedOn: "2026-10-15",
    };
    const html = await renderFlat(CaseStatusChanged({ ...base, next: nextStepsFor(input), alsoLinks: alsoLinksFor(input) }));
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at("<strong>The I-140"),
      at('href="https://permtracker.app/tools/i140-calculator"'),
      at("<strong>The receipt number"),
      at('href="https://permtracker.app/uscis-case-status"'),
      at("<strong>Your priority date"),
      at("Email me when the bulletin moves"),
      at("<strong>The rest of the way"),
      at('href="https://permtracker.app/tools/green-card-timeline"'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("I-140 wait: how long USCIS takes, and the premium processing clock");
  });

  it("dates a denial's 30 days in the email", async () => {
    const input = {
      program: "perm" as const,
      caseNumber: base.caseNumber,
      status: "DENIED",
      isFinal: true,
      approved: false,
      deniedOn: "2026-10-15",
    };
    const html = await renderFlat(
      CaseStatusChanged({ ...base, toStatus: "DENIED", tone: "closed", next: nextStepsFor(input), alsoLinks: alsoLinksFor(input) }),
    );
    expect(html).toContain("by about November 14, 2026");
    expect(html).toContain("https://permtracker.app/guides/perm-appeal-reconsideration-balca");
  });

  it("keeps every form name in the steps on one line (\"I-\" ended a phone line, \"485\" began the next)", async () => {
    const input = { program: "perm" as const, caseNumber: base.caseNumber, status: "CERTIFIED", isFinal: true, approved: true };
    const raw = await render(CaseStatusChanged({ ...base, next: nextStepsFor(input) }));
    const block = raw.slice(raw.indexOf("What comes next"), raw.indexOf("Where this sits"));
    expect(block).toContain('<span style="white-space:nowrap">I-485</span>');
    expect(block).toContain('<span style="white-space:nowrap">I-140</span>');
    // No form name left loose in the block's text.
    const loose = block.replace(/<span style="white-space:nowrap">[^<]*<\/span>/g, "").replace(/href="[^"]*"/g, "");
    expect(loose).not.toMatch(/\bI-\d{3}\b/);
  });

  it("drops the we-won't-guess line when the next step follows, and keeps it when nothing does", async () => {
    const lca = { program: "lca" as const, caseNumber: "I-200-26118-846661", status: "CERTIFIED", isFinal: true, approved: true };
    const withNext = await renderFlat(CaseStatusChanged({ ...base, caseNumber: lca.caseNumber, next: nextStepsFor(lca) }));
    expect(withNext).toContain("What comes next");
    expect(withNext).not.toContain("going to guess");
    const withoutNext = await renderFlat(CaseStatusChanged({ ...base, toStatus: "IN PROCESS", isFinal: false, next: null }));
    expect(withoutNext).toContain("going to guess");
  });

  it("never ends the preview line with two periods after a name ending in one", async () => {
    const html = await renderFlat(CaseStatusChanged({ ...base, next: null }));
    expect(html).toContain("G-100-26070-123456 at Example Systems, Inc. DOL\u2019s record has shown it since at least October 15, 2026.");
    expect(html).not.toContain("Inc..");
  });

  it("shows an LCA reader no PERM queue link", async () => {
    const input = { program: "lca" as const, caseNumber: "I-200-26118-846661", status: "CERTIFIED", isFinal: true, approved: true };
    const html = await renderFlat(
      CaseStatusChanged({ ...base, caseNumber: input.caseNumber, next: nextStepsFor(input), alsoLinks: alsoLinksFor(input) }),
    );
    expect(html).toContain("Form I-129");
    expect(html).not.toContain("perm-processing-times");
    expect(html).not.toContain("filing month DOL&#x27;s queue");
  });

  it("keeps the old links for a caller that passes none", async () => {
    const html = await renderFlat(CaseStatusChanged({ ...base, isFinal: false, toStatus: "RFI ISSUED" }));
    expect(html).toContain("https://permtracker.app/perm-processing-times");
    expect(html).not.toContain("What comes next");
  });
});

describe("the possible-PERM email", () => {
  it("says may, and says what was compared", async () => {
    const html = await renderFlat(PossiblePermMatch(PossiblePermMatch.PreviewProps));
    expect(html).toContain("A PERM application that may be yours");
    expect(html).toContain("G-100-26286-296040");
    expect(html).toContain("#watch");
    expect(html).toMatch(/The employer, the job title/);
    expect(html).not.toMatch(/\bis your (PERM|case)\b|your PERM (was|has been) filed/i);
  });
});

describe("a saved case's own email when DOL decides it", () => {
  it("carries the same steps, with the bulletin alert on the case's Green card tab", async () => {
    const caseUrl = "https://permtracker.app/cases/abc123";
    const next = forSavedCase(
      nextStepsFor({ program: "perm", caseNumber: base.caseNumber, status: "CERTIFIED", isFinal: true, approved: true, certifiedOn: "2026-10-15" }),
      caseUrl,
    );
    const html = await renderFlat(
      StatusChange({ ...StatusChange.PreviewProps, previousStatus: "ANALYST REVIEW", newStatus: "CERTIFIED", caseUrl, next }),
    );
    expect(html).toContain("What comes next");
    expect(html).toContain("April 12, 2027");
    expect(html).toContain(`href="${caseUrl}?tab=greenCard"`);
    expect(html).toContain("Turn on this case&#x27;s bulletin alert");
    expect(html).not.toContain("/visa-bulletin#bulletin-alert");
    // A change in the app's own stages says nothing more.
    expect(await renderFlat(StatusChange(StatusChange.PreviewProps))).not.toContain("What comes next");
  });
});
