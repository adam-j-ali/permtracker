import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PERM decisions beside wage determinations, and the decisions chart by day, week, month or year against a year
 * earlier: the pages that carry them read the same records through the same rules (src/lib/dolDays.ts,
 * src/lib/decisionPeriods.ts), on DOL's day.
 */
const PUBLIC = join(__dirname, "..", "(site)", "(public)");
const activity = readFileSync(join(PUBLIC, "perm-decision-activity", "page.tsx"), "utf8");
const home = readFileSync(join(PUBLIC, "page.tsx"), "utf8");

describe("the decisions page puts both counts side by side, and every period against a year earlier", () => {
  it("builds two weeks of complete days and the chart's views from DOL's day now", () => {
    expect(activity).toContain("const today = easternDay();");
    expect(activity).toContain('const sideBySide = dolDays(live?.days ?? [], wageDocs.queue?.days ?? [], today, 14);');
    expect(activity).toContain("const views = decisionViews(disclosure?.days ?? [], live?.days ?? [], today);");
  });

  it("draws the chart with its list of periods at the top, and the board above the day picker", () => {
    const chart = activity.indexOf("views={views}\n            table");
    const board = activity.indexOf("<DolDaysBoard days={sideBySide}");
    const picker = activity.indexOf('<section id="day"');
    expect(chart).toBeGreaterThan(-1);
    expect(board).toBeGreaterThan(chart);
    expect(board).toBeLessThan(picker);
  });
});

describe("the homepage shows the two weeks' figures and the way to the days", () => {
  it("draws the figures only, one heading level down, inside the live band", () => {
    const band = home.slice(home.indexOf("<LiveDataBand>"), home.indexOf("</LiveDataBand>"));
    expect(band).toContain("<PermPulse");
    expect(band).toContain("views={views}");
    expect(band).toContain("days={dolDays(observed, wageDocs.queue?.days ?? [], easternDay(), 14)}");
    expect(band).toContain("rows={false}");
    expect(band).toContain("level={3}");
    expect(band).toContain('more={{ href: "/perm-decision-activity#dol-days"');
  });
});
