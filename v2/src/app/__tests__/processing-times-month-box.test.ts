import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { embedBySlug } from "@/lib/embeds";

/**
 * The month DOL is deciding, where a reader can act on it. DOL's page stopped printing a filing month on Oct 31
 * 2026, and this page still measures it. A reader found the answer and, 62% of the way down the page, the box that
 * emails them when DOL reaches their own month. The box sits right under the answer now, the queue page has it
 * too, and the answer and its figures can be pasted into another site.
 */
const PUBLIC = join(__dirname, "..", "(site)", "(public)");
const times = readFileSync(join(PUBLIC, "perm-processing-times", "page.tsx"), "utf8");
const queue = readFileSync(join(PUBLIC, "perm-queue", "page.tsx"), "utf8");

describe("the processing-times page puts the email box under the answer", () => {
  it("draws the answer and figures, then the email box, then the chapters", () => {
    const box = times.indexOf('data-embed="perm-processing-times"');
    const alert = times.indexOf('<section id="month-alert"');
    const chapters = times.indexOf("<ChapterNav");
    expect(box).toBeGreaterThan(0);
    expect(alert).toBeGreaterThan(box);
    expect(chapters).toBeGreaterThan(alert);
    // One form on the page, and its old place keeps a way to it.
    expect(times.match(/<QueueAlertForm\b/g)).toHaveLength(1);
    expect(times.slice(chapters)).toContain('href="#month-alert"');
  });

  it("marks the months DOL has reached from our own check once DOL's page prints none", () => {
    expect(times).toContain("frontierMonth={analyst?.priorityDate ?? permLine?.month ?? undefined}");
  });

  it("answers which month DOL is on in its FAQ, filled from the day's reading", () => {
    expect(times).toContain('question: "Which month is DOL processing PERM applications from now?"');
    expect(times).toContain(".replace(MONTH_NOW, monthNow)");
    // The rule in the answer is the rule the month is found by (convex/lib/permLine.ts).
    expect(times).toContain("the oldest filing month DOL has decided fewer than half of");
  });

  it("offers the answer as one dated line to copy, kept out of the embed", () => {
    expect(times).toMatch(/<div data-embed-hide[^>]*>\s*<p[^>]*>\s*<span[^>]*>To quote it:<\/span> \{citeLine\}/);
    expect(times).toContain('<CopyButton text={citeLine} label="Copy the line" />');
    expect(times).toContain("PERM Tracker's daily check of DOL's case status, ${longDate(permLine.asOf) ?? permLine.asOf}");
  });

  // A site that keeps its own processing-times page gets the box's code where the answer is: one button copies it,
  // and one link opens its card, with a preview, on the embeds page.
  it("offers the box's own code to paste, kept out of the embed", () => {
    expect(times).toContain('const embedDef = embedBySlug("perm-processing-times");');
    expect(times).toContain("const embedCode = embedDef ? embedSnippet(embedDef, SITE_URL) : null;");
    expect(times).toMatch(/<div data-embed-hide id="on-your-page"[^>]*>\s*<p[^>]*>\s*<span[^>]*>To show it on your own page:<\/span>/);
    expect(times).toContain('<CopyButton text={embedCode} label="Copy the code" />');
    expect(times).toContain('<Link href="/badges#embed-perm-processing-times" className="link">');
  });

  it("gives every embed's card an address of its own on the embeds page", () => {
    const gallery = readFileSync(join(__dirname, "..", "..", "components", "badges", "EmbedGallery.tsx"), "utf8");
    expect(gallery).toContain("<li id={`embed-${e.slug}`} className=\"flex scroll-mt-24 flex-col");
    expect(embedBySlug("perm-processing-times")?.group).not.toBe("lookup");
  });
});

describe("the queue page has the email box too", () => {
  it("right under its three figures, with the reached months from our own check", () => {
    const figures = queue.indexOf('aria-label="The PERM queue in three figures"');
    const alert = queue.indexOf('<section id="month-alert"');
    const next = queue.indexOf('<section className="mt-6 border-2 shadow-hard', figures);
    expect(figures).toBeGreaterThan(0);
    expect(alert).toBeGreaterThan(figures);
    expect(next).toBeGreaterThan(alert);
    expect(queue).toContain('<QueueAlertForm source="perm-queue" newestMonth={currentMonthUtc()} frontierMonth={line?.month ?? undefined} />');
  });
});

describe("the box another site can paste", () => {
  it("is registered against the processing-times page, which carries its marker once", () => {
    const def = embedBySlug("perm-processing-times");
    expect(def?.href).toBe("/perm-processing-times");
    expect(times.match(/data-embed="perm-processing-times"/g)).toHaveLength(1);
  });
});
