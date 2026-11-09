import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BadgeCatalogue, type BadgeRow } from "@/components/badges/BadgeCatalogue";
import { EmbedGallery } from "@/components/badges/EmbedGallery";
import { BADGE_DEFS, BADGE_THEMES } from "@/lib/badge";
import { renderUnavailable } from "@/lib/badgeRender";

/**
 * /badges under axe (the deploy's page checks, Nov 9 2026): a picker button named by an aria-label that left out the
 * badge's own visible words (WCAG 2.5.3), and code boxes that scroll sideways with no tab stop (WCAG 2.1.1).
 */
const ROWS: BadgeRow[] = BADGE_DEFS.map((def) => ({
  kind: def.id,
  group: def.group,
  label: def.label,
  meaning: def.meaning,
  href: def.href,
  unavailable: true,
  variants: def.styles.flatMap((style) =>
    BADGE_THEMES.map((theme) => ({ style, theme, path: `${def.id}.${style}.${theme}`, svg: renderUnavailable(def.id, style, theme) })),
  ),
  styles: [...def.styles],
}));

const html = renderToStaticMarkup(<BadgeCatalogue rows={ROWS} origin="https://permtracker.app" />);

describe("the badge catalogue", () => {
  it("names each picker button by its label alone, the badge hidden from the name", () => {
    // The matrix's cells; the shape, background and format pickers are named by their own visible words.
    const buttons = html.match(/<td[^>]*><button[^>]*aria-pressed[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      const tag = b.slice(b.indexOf("<button"));
      expect(tag.slice(0, tag.indexOf(">")), tag.slice(0, 120)).not.toContain("aria-label=");
      expect(b).toMatch(/<span class="sr-only">[^<]+ <\/span>/);
      expect(b).toContain('aria-hidden="true"');
    }
  });

  it("gives every code box that scrolls a tab stop and a name", () => {
    const pres = html.match(/<pre[^>]*>/g) ?? [];
    expect(pres.length).toBeGreaterThan(0);
    for (const p of pres) {
      expect(p).toContain('tabindex="0"');
      expect(p).toContain('role="region"');
      expect(p).toMatch(/aria-label="[^"]+ code"/);
    }
  });
});

describe("the embed gallery", () => {
  it("gives every snippet box a tab stop and a name", () => {
    const pres = renderToStaticMarkup(<EmbedGallery origin="https://permtracker.app" />).match(/<pre[^>]*>/g) ?? [];
    expect(pres.length).toBeGreaterThan(0);
    for (const p of pres) expect(p).toMatch(/role="region"[^>]*aria-label="Embed code"[^>]*tabindex="0"/);
  });
});
