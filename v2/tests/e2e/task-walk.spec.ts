import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

/**
 * The task walk: every question a visitor asks reaches the one page that answers it in a few taps from the homepage,
 * through the real header, menus and page, at phone and desktop widths (the owner's rule, Nov 24 2026). The questions
 * and their pages are scripts/data/question_map.json. A top task is 2 taps away on a phone (Menu, the page) and 1 on a
 * desktop; any other 3 on a phone (Menu, Data, the page: the Data list stays folded, his call) and 2 on a desktop.
 *
 * Read-only: it opens menus and reads links, and never follows one.
 */

type Row = { question: string; page: string; top?: boolean };
const ROWS: Row[] = (
  JSON.parse(readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "scripts", "data", "question_map.json"), "utf8")) as { questions: Row[] }
).questions;

/** The paths of the links a person can see now (a link in a closed menu or a hidden bar has no box). */
async function visiblePaths(page: Page, scope = "body"): Promise<string[]> {
  const origin = new URL(page.url()).origin;
  const hrefs = await page.$$eval(`${scope} a[href]`, (links) =>
    links
      .filter((a) => {
        const box = a.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(a).visibility !== "hidden";
      })
      .map((a) => (a as HTMLAnchorElement).href),
  );
  return hrefs
    .map((h) => new URL(h))
    .filter((u) => u.origin === origin)
    .map((u) => u.pathname.replace(/\/+$/, "") || "/");
}

function record(taps: Map<string, number>, paths: string[], n: number) {
  for (const p of paths) if ((taps.get(p) ?? Infinity) > n) taps.set(p, n);
}

function judge(taps: Map<string, number>, budget: (r: Row) => number): string[] {
  return ROWS.filter((r) => (taps.get(r.page) ?? Infinity) > budget(r)).map(
    (r) => `${r.question} -> ${r.page}: ${taps.has(r.page) ? `${taps.get(r.page)} taps` : "no menu or page reaches it"}, at most ${budget(r)}`,
  );
}

test("the question map names one page per question", () => {
  expect(ROWS.length).toBeGreaterThan(20);
  const asked = ROWS.map((r) => r.question.toLowerCase());
  expect(asked.filter((q, i) => asked.indexOf(q) !== i)).toEqual([]);
  const pages = ROWS.map((r) => r.page);
  expect(pages.filter((p, i) => pages.indexOf(p) !== i)).toEqual([]);
});

test("on a phone, every question's page is a few taps from the homepage", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto("/");
  const taps = new Map<string, number>();
  record(taps, await visiblePaths(page), 1);
  await page.locator("header button[aria-expanded]", { hasText: "Menu" }).click();
  const menu = 'nav[aria-label="Menu"]';
  await expect(page.locator(menu)).toBeVisible();
  record(taps, await visiblePaths(page, menu), 2);
  for (const fold of ["Data", "Learn"]) {
    await page.locator(`${menu} summary`, { hasText: fold }).click();
    record(taps, await visiblePaths(page, menu), 3);
  }
  // A walk that opened nothing is broken, not clean: the open menus hold scores of pages.
  expect(taps.size).toBeGreaterThan(60);
  expect(judge(taps, (r) => (r.top ? 2 : 3))).toEqual([]);
  await context.close();
});

test("on a desktop, every question's page is a click or two from the homepage", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  const taps = new Map<string, number>();
  record(taps, await visiblePaths(page), 1);
  for (const menu of ["Data", "Learn"]) {
    await page.locator("header button[aria-expanded]", { hasText: menu }).first().click();
    record(taps, await visiblePaths(page), 2);
    await page.keyboard.press("Escape");
  }
  expect(taps.size).toBeGreaterThan(60);
  expect(judge(taps, (r) => (r.top ? 1 : 2))).toEqual([]);
  await context.close();
});
