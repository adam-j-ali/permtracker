// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@react-email/render";

import { DailyReport } from "../DailyReport";
import type { DailyReport as Report } from "../../../convex/lib/dailyReportCompose";

/**
 * The report is read on a phone. A typewriter face and stacked left padding
 * left about 26 characters a line, and every OK section printed its detail in
 * full, so the mail ran to 62 KB. The detail stays in the text part and on
 * /admin#monitor; the HTML part carries what needs a look.
 */
const report: Report = {
  day: "2026-11-23",
  generatedAt: 0,
  sections: [
    {
      key: "site",
      title: "The site",
      status: "warn",
      summary: "2 pages over the size budget",
      lines: ["/perm-employers: 1.9 MB", "/perm-wages: 1.7 MB"],
    },
    {
      key: "traffic",
      title: "Traffic",
      status: "ok",
      summary: "2,010 people yesterday",
      lines: ["Google clicks: 480", "Pageviews: 10,500"],
    },
  ],
};

const withoutStylesheets = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "");

describe("the daily report on a phone", () => {
  it("prints each detail line as its own paragraph in the body face", async () => {
    // Act
    const html = withoutStylesheets(await render(DailyReport({ report })));
    // Assert
    expect(html).not.toMatch(/monospace/i);
    expect(html).not.toMatch(/border-left/i);
    expect(html).toMatch(/<p[^>]*>\/perm-employers: 1\.9 MB<\/p>/);
    expect(html).toMatch(/<p[^>]*>\/perm-wages: 1\.7 MB<\/p>/);
    expect(html).not.toContain("<br");
  });

  it("keeps an OK section to its one line; the detail stays in the text part", async () => {
    // Act
    const html = withoutStylesheets(await render(DailyReport({ report })));
    // Assert
    expect(html).toContain("2,010 people yesterday");
    expect(html).not.toContain("Google clicks: 480");
  });

  it("gives the text more of a narrow screen", async () => {
    // Act
    const html = await render(DailyReport({ report }));
    // Assert
    expect(html).toMatch(/class="[^"]*em-dense-content/);
    expect(html).toMatch(
      /@media only screen and \(max-width: 600px\)[\s\S]*?\.em-dense-content \{ padding:/,
    );
  });
});
