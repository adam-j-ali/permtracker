#!/usr/bin/env node
/**
 * Measure pages at phone widths: does the page scroll sideways, and if so which
 * element does it; text under 14px; standalone tap targets under 43px; and text a
 * highlight covers (lib_covered_text.mjs), at the phone widths and, resized in
 * place, at tablet and desktop widths too.
 *
 * One headless Chrome, pages loaded one after another, closed in `finally`
 * (never run two headless browsers at once on this Mac). For when the site's
 * own frame headers (X-Frame-Options: DENY, even on `pnpm dev`) rule out the
 * same-origin iframe sweep.
 *
 *   node scripts/phone_sweep.mjs http://localhost:3010 /visa-issuances /perm-cities/appleton-wi
 *   SHOTS=/tmp/shots node scripts/phone_sweep.mjs https://permtracker.app /    # screenshots too
 *
 * Read the first run as mostly a test of this script (it was, Oct 5 2026):
 * - The phone menu drawer sits off-screen on purpose; anything inside a fixed
 *   nav is skipped.
 * - A link inside a truncated (overflow: hidden) row reaches past the edge and
 *   is clipped, not overflowing: only the page's own scroll width is a verdict.
 * - When the page does overflow, `culprit` hides each section of <main> in
 *   turn and names the ones whose removal ends it, then the innermost
 *   elements past the edge.
 * - An inline link inside a sentence is exempt from the tap size (WCAG 2.5.8), a checkbox counts by
 *   its label, and a button out of the tab order inside a full-size field is a shortcut, not a target.
 * - The sentence rule has a probe: serve scripts/fixtures/phone_sweep_probe.html as /index.html and
 *   sweep it. It prints taps=5 at each width: the four links alone on a line and the name over a
 *   count, never the link in a sentence, the link through a <b>, the source line or the link that
 *   is a cell's whole content. A change to the rule that prints any other count changed the rule.
 */
import { chromium } from "playwright-core";

import { coveredText } from "./lib_covered_text.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [base, ...paths] = process.argv.slice(2);
if (!base || !paths.length) {
  console.error("usage: node scripts/phone_sweep.mjs <base-url> <path> [path ...]");
  process.exit(2);
}
const WIDTHS = [390, 320];
// Covered text depends on where lines break, so it's checked wider too: the 390 page is resized in place.
const WIDE = [768, 1024, 1440];

function measure(w) {
  const doc = document.documentElement;
  const overflow = doc.scrollWidth - doc.clientWidth;
  const label = (el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`;
  let culprit = [];
  if (overflow > 0) {
    const sections = [...document.querySelectorAll("main > *, main > * > *, main > * > * > *")];
    for (const s of sections) {
      const prev = s.style.display;
      s.style.display = "none";
      const gone = doc.scrollWidth - doc.clientWidth <= 0;
      s.style.display = prev;
      if (gone) culprit.push(label(s));
    }
    const innermost = [...document.querySelectorAll("main *")].filter((el) => {
      if (el.closest("nav.fixed")) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.right > w + 1 && ![...el.children].some((c) => c.getBoundingClientRect().right > w + 1);
    });
    culprit = [...culprit.slice(-3), ...innermost.slice(0, 4).map((el) => `${label(el)} right=${Math.round(el.getBoundingClientRect().right)} "${(el.textContent || "").trim().slice(0, 40)}"`)];
  }
  const small = [];
  for (const el of document.querySelectorAll("main p, main li, main td, main th, main dd, main dt, main span, main a, main button, main label, main summary")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    // A drawing's own text (a drawn window's address) is hidden from readers and drawn to scale.
    if (el.closest('svg, [aria-hidden="true"], [inert]') || el.getBoundingClientRect().width === 0) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 14) small.push(`${el.tagName.toLowerCase()} ${fs}px "${el.textContent.trim().slice(0, 30)}"`);
  }
  const taps = [];
  for (const el of document.querySelectorAll("main a, main button, main summary, main select, main input")) {
    // A field's target is the label around it, which a tap anywhere focuses (a search box drawn
    // as a 44px labelled box holds a 42px input); a checkbox's is its label, wrapped or by id. A
    // button out of the tab order inside a field whose own control is full size is a shortcut
    // (WCAG 2.5.8's equivalent-control exception).
    const label = el.matches("input[type=checkbox], input[type=radio]")
      ? el.closest("label") ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null)
      : el.matches("input, select, textarea")
        ? el.closest("label")
        : null;
    // Nothing a person can reach (a form's hidden honeypot, an inert copy) is a tap target.
    if (el.closest('[aria-hidden="true"], [inert]')) continue;
    const b = (label ?? el).getBoundingClientRect();
    // WCAG 2.5.8's inline exception: a link set in a sentence. The sentence is judged in the link's own
    // block (its nearest ancestor that isn't inline): a paragraph, a list item or a cell holds running
    // text by its nature, and any other block counts when words that aren't a control sit on the link's
    // own line (a FinePrint note's source line). Words in a block of their own under the link (a bar, a
    // count on the next line) don't make it a sentence. Any link under a cell used to pass, so a firm's
    // name alone on its own line of a phone row read as "in a sentence" and its 20px target shipped
    // (Nov 12 2026: the deploy's axe check caught it, this sweep had said taps=0).
    const blockOf = (e) => {
      let b = e.parentElement;
      while (b && getComputedStyle(b).display.startsWith("inline")) b = b.parentElement;
      return b;
    };
    const wordsOnItsLine = (b, e) => {
      let n = 0;
      const walk = (node) => {
        for (const c of node.childNodes) {
          if (c === e) continue;
          if (c.nodeType === 3) n += c.textContent.replace(/\s+/g, " ").trim().length;
          else if (c.nodeType === 1 && !c.matches("a, button, summary, select, input, label, svg") && getComputedStyle(c).display.startsWith("inline")) walk(c);
        }
      };
      walk(b);
      return n > 1;
    };
    const sentence = (e) => {
      const b = blockOf(e);
      return Boolean(b) && (b.matches("p, li, dd, td") || wordsOnItsLine(b, e));
    };
    const inline = getComputedStyle(el).display === "inline" && sentence(el);
    const shortcut = el.tabIndex === -1 && [...(el.parentElement?.querySelectorAll("input") ?? [])].some((i) => i.getBoundingClientRect().height >= 43);
    if (b.width > 0 && b.height > 0 && b.height < 43 && !inline && !shortcut) taps.push(`${el.tagName.toLowerCase()} ${Math.round(b.height)}px "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`);
  }
  return { overflow, culprit, small: [...new Set(small)].slice(0, 5), smallN: small.length, taps: [...new Set(taps)].slice(0, 5), tapsN: taps.length };
}

let bad = 0;
// How long one page may take to load. PT_LOAD_TIMEOUT_MS shortens it for a probe of this script.
const LOAD_MS = Number(process.env.PT_LOAD_TIMEOUT_MS) || 90000;

/** The requests a page hadn't finished, as host and path (no query string: one can carry a token). Five at most. */
function stillOpen(open) {
  const seen = new Set();
  for (const url of open.values()) {
    try {
      const u = new URL(url);
      seen.add(u.origin === new URL(base).origin ? u.pathname : u.host + u.pathname);
    } catch {
      seen.add(String(url).slice(0, 60));
    }
  }
  return [...seen].slice(0, 5).map((x) => x.slice(0, 90)).join(", ");
}
// The Mac's own Chrome here; installed Chrome by its channel anywhere else (GitHub's runners carry it),
// or Playwright's own Chromium where no Chrome is built (the deploy's ARM runner: PT_BROWSER=chromium).
const browser = await chromium.launch(
  process.platform === "darwin"
    ? { executablePath: CHROME, headless: true }
    : process.env.PT_BROWSER === "chromium"
      ? { headless: true }
      : { channel: "chrome", headless: true },
);
try {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    // What the page is still waiting on when a load runs out of time. A load that hangs on someone else's script
    // reads the same as one that hangs on our own page until the open requests are named (Nov 11 2026: about
    // seven 90 s timeouts in one deploy's sweep, with nothing in the site's own log).
    const open = new Map();
    page.on("request", (r) => open.set(r, r.url()));
    for (const ended of ["requestfinished", "requestfailed"]) page.on(ended, (r) => open.delete(r));
    for (const p of paths) {
      open.clear();
      // Load, then up to 8 s for the network to go quiet. Waiting for quiet alone cost 2 minutes a width on a
      // page that keeps a request open, and the deploy's sweep ran out of its 10 minutes (Nov 1 2026).
      const t0 = Date.now();
      const ok = await page.goto(base + p, { waitUntil: "load", timeout: LOAD_MS }).then(() => true, (e) => (console.log(`${width} ${p} load failed: ${String(e).slice(0, 80)}`), false));
      if (!ok) {
        console.log(`${width} ${p} was still waiting on: ${stillOpen(open) || "nothing it had asked for"}`);
        bad++;
        continue;
      }
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const r = await page.evaluate(measure, width);
      const covered = (await page.evaluate(coveredText)).map((c) => `${width}: ${c}`);
      if (width === WIDTHS[0]) {
        for (const wide of WIDE) {
          await page.setViewportSize({ width: wide, height: 900 });
          covered.push(...(await page.evaluate(coveredText)).map((c) => `${wide}: ${c}`));
        }
        await page.setViewportSize({ width, height: 844 });
      }
      if (r.overflow > 0 || r.smallN || r.tapsN || covered.length) bad++;
      console.log(`${width} ${p}  overflow=${r.overflow}px  small=${r.smallN}  taps=${r.tapsN}  covered=${covered.length}  (${secs} s)`);
      for (const c of r.culprit) console.log(`    wide: ${c}`);
      for (const s of r.small) console.log(`    small: ${s}`);
      for (const t of r.taps) console.log(`    tap: ${t}`);
      for (const c of covered.slice(0, 6)) console.log(`    covered: ${c}`);
      if (process.env.SHOTS && width === 390) await page.screenshot({ path: `${process.env.SHOTS}/${p.replace(/\W+/g, "_") || "home"}-${width}.png` });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
