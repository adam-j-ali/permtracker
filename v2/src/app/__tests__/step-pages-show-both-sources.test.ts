import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SECTIONS, type DataGroup } from "@/lib/siteMap";
import { STEP_PAGES } from "@/lib/stepSources";

/**
 * Every page about a green card step shows both sources: the agency's own figure and people's reported cases
 * (StepBothSources), or is listed exempt with its reason (src/lib/stepSources.ts). Owner, Nov 20 2026: "find and fix
 * all and going forward so it's not wackamole". A new page in a step's group of the site map fails here until it's
 * classified, and a listed page that drops the section fails too.
 */

/** The site map's groups that are steps of the green card path, and the two H-1B pages that are a step too. */
const STEP_GROUPS: readonly DataGroup[] = ["Wage request", "Recruitment", "PERM", "I-140", "Green card line"];
const ALSO = ["/lca-cases", "/h1b-lottery-odds", "/green-card-timelines", "/tools/green-card-timeline", "/perm-case-status"];

const pageFile = (href: string) => join(process.cwd(), "src/app/(site)/(public)", href, "page.tsx");

describe("every step page shows both sources", () => {
  const stepPages = [...SECTIONS.filter((x) => STEP_GROUPS.includes(x.group as DataGroup)).map((x) => x.href), ...ALSO];

  it("classifies every page in a step's group: its steps, or why it's exempt", () => {
    const missing = stepPages.filter((href) => !(href in STEP_PAGES));
    expect(missing, "pages in a step's group of the site map with no entry in STEP_PAGES").toEqual([]);
  });

  it("renders the section on every page listed with steps, for those steps", () => {
    const offenders: string[] = [];
    for (const [href, page] of Object.entries(STEP_PAGES)) {
      if ("exempt" in page) continue;
      const file = pageFile(href);
      if (!existsSync(file)) {
        offenders.push(`${href}: no page file at ${file}`);
        continue;
      }
      const src = readFileSync(file, "utf8");
      if (!src.includes("<StepBothSources")) {
        offenders.push(`${href}: no <StepBothSources>`);
        continue;
      }
      for (const g of page.groups) {
        if (!new RegExp(`<StepBothSources[^>]*groups=\\{\\[[^\\]]*"${g}"`).test(src)) offenders.push(`${href}: ${g} not shown`);
      }
      if (!page.reported && !/<StepBothSources[^>]*reported=\{false\}/.test(src)) offenders.push(`${href}: should add the agency's figures only`);
    }
    expect(offenders).toEqual([]);
  });

  it("gives every exemption a reason", () => {
    for (const [href, page] of Object.entries(STEP_PAGES)) {
      if ("exempt" in page) expect(page.exempt.length, href).toBeGreaterThan(20);
    }
  });
});
