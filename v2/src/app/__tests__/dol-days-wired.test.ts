import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PERM decisions beside wage determinations, and each month against a year earlier: the two pages that carry them
 * read the same records through the same rules (src/lib/dolDays.ts, src/lib/decisionMonths.ts), on DOL's day.
 */
const PUBLIC = join(__dirname, "..", "(site)", "(public)");
const activity = readFileSync(join(PUBLIC, "perm-decision-activity", "page.tsx"), "utf8");
const home = readFileSync(join(PUBLIC, "page.tsx"), "utf8");

describe("the decisions page puts both counts side by side, and months against a year earlier", () => {
  it("builds two weeks of complete days and twelve months from DOL's day now", () => {
    expect(activity).toContain("const today = easternDay();");
    expect(activity).toContain('const sideBySide = dolDays(live?.days ?? [], wageDocs.queue?.days ?? [], today, 14);');
    expect(activity).toContain('monthsAgainstLastYear(series.find((s) => s.source === "dol-disclosure")?.days ?? [], live?.days ?? [], today, 12)');
  });

  it("draws the board above the day picker and the months after the weekly chart", () => {
    const board = activity.indexOf("<DolDaysBoard days={sideBySide}");
    const picker = activity.indexOf('<section id="day"');
    const weekly = activity.indexOf('title="Decisions per week"');
    const months = activity.indexOf("<DecisionMonths months={byMonth} checksFrom={live?.days[0]?.date ?? null}");
    expect(board).toBeGreaterThan(-1);
    expect(months).toBeGreaterThan(-1);
    expect(board).toBeLessThan(picker);
    expect(months).toBeGreaterThan(weekly);
  });
});

describe("the homepage shows the two weeks' figures and the way to the days", () => {
  it("draws the figures only, one heading level down, inside the live band", () => {
    const band = home.slice(home.indexOf("<LiveDataBand>"), home.indexOf("</LiveDataBand>"));
    expect(band).toContain("<PermPulse");
    expect(band).toContain("days={dolDays(observed, wageDocs.queue?.days ?? [], easternDay(), 14)}");
    expect(band).toContain("rows={false}");
    expect(band).toContain("level={3}");
    expect(band).toContain('more={{ href: "/perm-decision-activity#dol-days"');
  });
});
