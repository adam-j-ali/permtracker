/**
 * Two of the phone sweep's checks, each run inside the page (Playwright's page.evaluate), so each function
 * holds everything it uses: nothing from this module's scope reaches the page.
 *
 * - `pastTheEdge(edge)`: elements in <main> whose right edge passes the screen's and that no box clips or
 *   scrolls. Since Oct 17 2026 body has overflow-x: clip, which stops the page scrolling sideways at all, so
 *   the page's own scroll width read 0 whatever spilled out of a card (a long job title in an employer
 *   page's search chip, Nov 23 2026). This names the spill whatever body does.
 * - `splitNames(source)`: a program or form name drawn across two lines ("CW-" then "1"). The pattern is
 *   src/lib/programNames.json's, the one KeepWhole and the articles' plugin use; it's passed in as a string.
 */
import programNames from "../src/lib/programNames.json" with { type: "json" };

/** The program-name pattern's source, from the file the site builds its own pattern from. */
export const PROGRAM_NAME_SOURCE = programNames.source;

export function pastTheEdge(edge) {
  const label = (el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`;
  // A box that scrolls or clips sideways keeps what's in it from reaching past the screen (a table in its
  // scroller, a truncated row). body and html don't count: body's clip is the thing this check sees past.
  const held = (el) => {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      // The longhand, or the shorthand's first word where a DOM leaves the longhand empty.
      const x = cs.overflowX || (cs.overflow || "").split(" ")[0];
      if (cs.position === "fixed" || /^(auto|scroll|hidden|clip)$/.test(x)) return true;
    }
    return false;
  };
  // Off-screen on purpose: the phone menu's drawer in its fixed nav, anything hidden from readers.
  const ignored = (el) => {
    if (el.closest('nav.fixed, [aria-hidden="true"], [inert]')) return true;
    const cs = getComputedStyle(el);
    return cs.position === "fixed" || cs.visibility === "hidden";
  };
  const past = [];
  for (const el of document.querySelectorAll("main *")) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0 || b.right <= edge + 1) continue;
    if (ignored(el) || held(el)) continue;
    past.push(el);
  }
  // The outermost of each spill names it: its children past the edge are part of the same thing.
  const inSpill = new Set(past);
  return past
    .filter((el) => !inSpill.has(el.parentElement))
    .map((el) => `${label(el)} right=${Math.round(el.getBoundingClientRect().right)} "${(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)}"`);
}

export function splitNames(source) {
  const re = new RegExp(source, "g");
  const label = (el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`;
  // Not drawn for a reader, or drawn exactly as written (code keeps its own breaks).
  const skipped = (el) =>
    !!el.closest('svg, [aria-hidden="true"], [inert], .sr-only, pre, code, script, style, textarea, noscript') ||
    (!!el.closest("details:not([open])") && !el.closest("summary"));
  // The lines a run of text is drawn on: rects whose tops differ by more than half a line are on different lines.
  const lines = (rects) => {
    const tops = [];
    for (const r of rects) if (!tops.some((t) => Math.abs(t - r.top) < Math.max(2, r.height / 2))) tops.push(r.top);
    return tops.length;
  };
  const main = document.querySelector("main");
  if (!main) return [];
  const found = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent || "";
    const el = n.parentElement;
    if (!el || text.length < 3 || skipped(el)) continue;
    for (const m of text.matchAll(re)) {
      const range = document.createRange();
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (lines(rects) > 1) found.push(`${m[0]} in ${label(el)}`);
    }
  }
  return [...new Set(found)];
}
