import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The order of /email-preferences: the title, the way in (the form for a link to your preferences) beside a picture
 * of what arrives, then the three rules, then every kind of email. The page's one lime thing is the form's button,
 * so the rules' icons are green ink.
 */
const SRC = readFileSync(join(process.cwd(), "src/app/(site)/(public)/email-preferences/page.tsx"), "utf8");
const page = SRC.slice(SRC.indexOf("export default function EmailPreferencesPage"));

function at(mark: string): number {
  const i = page.indexOf(mark);
  expect(i, `not found: ${mark}`).toBeGreaterThan(-1);
  return i;
}

describe("the email preferences page", () => {
  it("opens on the form beside what arrives, then the rules, then every kind", () => {
    const order = ["<h1", "<PrefsRequestForm", "<AlertLanesFigure", "MAIL_RULES.map", 'id="kinds-heading"'].map(at);
    expect(order.every((x, i) => i === 0 || x > order[i - 1]!)).toBe(true);
    // Two unequal columns on a wide screen: the form wider than the figure.
    expect(page).toContain("lg:grid-cols-12");
    expect(page).toContain("lg:col-span-7");
    expect(page).toContain("lg:col-span-5");
  });

  it("keeps lime off the rules' icons", () => {
    const rules = page.slice(at("MAIL_RULES.map"), at('id="kinds-heading"'));
    expect(rules).not.toMatch(/text-primary(?!-)/);
  });
});
