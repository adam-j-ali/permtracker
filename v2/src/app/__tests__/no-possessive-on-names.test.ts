import { describe, expect, it } from "vitest";

import { possessivesIn, possessivesInFiles, sourceFiles } from "../../../test-utils/possessive-on-value";

/**
 * No page, card, sentence builder or Convex function builds a possessive on a name it fills in. DOL prints
 * employer and firm names in capitals and with their own endings, so `${row.name}'s` made "MERIT LOGISTICS's"
 * (Nov 23 2026); the copy says "the filings of", "cases at" or "the page for" instead. The email templates are
 * held by email-voice.test.ts. A value that is never a printed name (a month, a fiscal year, an agency, a visa
 * bulletin line, a rival tracker's own name) is listed below by file, with what it is.
 */

const ROOT = process.cwd();

/** Values that are never a DOL-printed name, by file. The value is the interpolation exactly as written. */
const NOT_A_NAME: Record<string, Record<string, string>> = {
  "src/app/(site)/(public)/compare/page.tsx": { "${t.name}": "a rival tracker's name, as it writes it" },
  "src/app/(site)/(public)/perm-queue/[month]/page.tsx": { "${label}": "a month" },
  "src/app/(site)/(public)/pwd-cases/page.tsx": { "${longDate(line.before.day)}": "a date" },
  "src/app/(site)/(public)/visa-bulletin/page.tsx": { "{monthLabel(last.bulletinMonth)}": "a month" },
  "src/components/community/OfficeTimelines.tsx": { "${office.name}": "a USCIS office, as USCIS names it" },
  "src/components/figures/bulletin-cutoff/model.ts": { "${run.label}": "a visa bulletin line" },
  "src/components/figures/dol-queue/model.ts": { "${monthYear(front)}": "a month" },
  "src/components/figures/pwd-queue/model.ts": { "${monthYear(front)}": "a month" },
  "src/components/queue/NextMonthStart.tsx": { "{now}": "a month" },
  "src/components/refusals/RefusalYearTable.tsx": { "${fyLabel(fy)}": "a fiscal year" },
  "src/components/tools/CaseAlertForm.tsx": { "{noun}": "the word for the record, \"case\" or \"wage request\"" },
  "src/components/tools/DenialReach.tsx": { "{unitLabel.toLowerCase()}": "a column's own label" },
  "src/components/tools/GreenCardLine.tsx": { "{result.supply.fy}": "a fiscal year" },
  "src/components/tools/SeasonalTimingPanel.tsx": { "${g.letter}": "a letter group" },
  "src/components/tools/planner/BulletinWays.tsx": { "${lineName}": "a visa bulletin line" },
  "src/components/tools/planner/ConsulateChoice.tsx": { "{picked.name}": "a consulate, as the State Department names it" },
  "src/lib/scorecard/verdict.ts": { "${name}": "a rival tracker's name, as it writes it" },
  "src/lib/wageLevelEstimate.ts": { "${o.jobZone}": "a Job Zone's number" },
  "convex/lib/bulletinPushWords.ts": { "${line}": "a visa bulletin line" },
  "src/lib/dailyUpdate.ts": { "${weekday}": "a day of the week", "${next}": "a day of the week" },
  "convex/lib/ruleSteps.ts": { "${who}": "an agency" },
  "convex/lib/spamCheck.ts": { "${brand}": "a brand a spam message borrows" },
};

const FILES = [
  ...sourceFiles(ROOT, "src", (p) => p === "src/emails"),
  ...sourceFiles(ROOT, "convex"),
];

describe("no possessive on a printed name", () => {
  it("reads the pages, the components, the libraries and Convex", () => {
    expect(FILES.length).toBeGreaterThan(1000);
    expect(FILES.some((f) => f.startsWith("convex/") && f.endsWith("http.ts"))).toBe(true);
    expect(FILES.some((f) => f.startsWith("src/emails/"))).toBe(false);
  });

  it("builds none outside the listed values", () => {
    const found = possessivesInFiles(ROOT, FILES)
      .filter((h) => !(NOT_A_NAME[h.file] && h.value in NOT_A_NAME[h.file]!))
      .map((h) => `${h.file}:${h.line}: ${h.value}`);
    expect(found).toEqual([]);
  });

  it("would catch each way the copy writes one, and leaves a plural or a contraction alone", () => {
    const caught = (line: string) => possessivesIn("x.tsx", line).map((h) => h.value);
    expect(caught("subject={`${row.name}'s`}")).toEqual(["${row.name}"]);
    expect(caught("In {firmName}&apos;s own words")).toEqual(["{firmName}"]);
    expect(caught("These are {who}’s PERM wage requests")).toEqual(["{who}"]);
    expect(caught("`moves ${names(byGroup)}\\u2019s cases`")).toEqual(["${names(byGroup)}"]);
    expect(caught("`${escapeHtml(list.join(\", \"))}'s page`")).toEqual(["${escapeHtml(list.join(\", \"))}"]);
    expect(caught("`${n} cases at ${name}`")).toEqual([]);
    expect(caught("{count}s ago, ${x}'ll do, ${y}'say")).toEqual([]);
  });
});
