import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Privacy Policy's section on timelines people share says what the form and the backend do, in the form's own
 * words. Its floors are read from the code's constants, so a changed floor changes the policy with it; a number
 * typed into the section would stay behind (it said 25 while the code said 10 for a morning on Nov 11 2026, before
 * the page was released).
 */

const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const page = read("app/(site)/(public)/privacy/page.tsx");
const start = page.indexOf('id="community-timelines"');
const section = flat(page.slice(start, page.indexOf('id="consulate-reports"')));

describe("the privacy page and the timelines people share", () => {
  it("finds the section", () => {
    expect(start).toBeGreaterThan(0);
    expect(section.length).toBeGreaterThan(500);
  });

  it("states each floor from the code's constant, never as a typed number", () => {
    for (const name of ["BOARD_OPENS_AT", "OFFICE_LIST_OPENS_AT", "METRIC_MIN_N", "MIN_CASE_REPORTERS"]) {
      expect(section, name).toContain(`{${name}}`);
    }
    expect(section).not.toMatch(/until \d+ people|fewer than \d+ timelines|at least \d+ people/);
  });

  it("quotes the form's own label for sharing", () => {
    const form = flat(read("components/community/TimelineFormFields.tsx"));
    const label = "Show my timeline in the public lists";
    expect(form).toContain(`${label}.`);
    expect(section).toContain(`&quot;${label}&quot;`);
  });

  it("says a timeline is looked at before it shows, that a case number is optional, and what the edit code does", () => {
    expect(section).toMatch(/We look at each timeline before it shows or counts anywhere/);
    expect(section).toMatch(/A PERM case number is optional/);
    expect(section).toMatch(/edit code/);
    expect(section).toMatch(/USCIS office handling your I-485/);
    expect(section).toMatch(/biometrics appointment/);
  });
});
