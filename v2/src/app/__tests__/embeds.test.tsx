import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmbedGallery } from "@/components/badges/EmbedGallery";
import { EmbedFrame, embedCss, embedMetadata } from "@/components/embed/EmbedFrame";
import { EMBEDS, embedBySlug, embedFrameHeight, embedSiteFor, embedSnippet, siteKeyOf } from "@/lib/embeds";
import RfiDeadlinePage from "../(site)/(public)/tools/rfi-deadline/page";

/**
 * The embed registry, its routes, and the page sections they frame, held
 * together. An embed shows its tool's own marked section, so three things
 * must agree for every slug: the registry entry, a route under /embed, and a
 * `data-embed` marker on the page the route imports. A marker renamed on the
 * page would otherwise leave an embed that renders an empty frame.
 */

const APP = join(__dirname, "..");
const EMBED_DIR = join(APP, "embed");
const PUBLIC = join(APP, "(site)", "(public)");

function routeSource(slug: string): string {
  return readFileSync(join(EMBED_DIR, slug, "page.tsx"), "utf8");
}

describe("the embed registry", () => {
  it("has a route for every entry and an entry for every route", () => {
    const dirs = readdirSync(EMBED_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs.length).toBeGreaterThanOrEqual(19);
    expect(dirs).toEqual(EMBEDS.map((e) => e.slug).sort());
  });

  it.each(EMBEDS.filter((e) => e.slug !== "case-status").map((e) => [e.slug, e] as const))(
    "%s frames the page its registry entry links, and that page carries its marker",
    (slug, def) => {
      const src = routeSource(slug);
      const m = /import ToolPage from "@\/app\/\(site\)\/\(public\)(\/[^"]+)\/page";/.exec(src);
      expect(m, `${slug} imports a public page`).not.toBeNull();
      expect(m![1]).toBe(def.href === "/visa-bulletin" ? "/tools/priority-date-calculator" : def.href);
      const page = readFileSync(join(PUBLIC, ...m![1]!.split("/").filter(Boolean), "page.tsx"), "utf8");
      const markers = [...page.matchAll(/data-embed="([^"]+)"/g)].flatMap((x) => x[1]!.split(" "));
      expect(markers).toContain(slug);
      expect(src).toContain(`embedMetadata("${slug}")`);
      expect(src).toContain(`<EmbedFrame slug="${slug}">`);
    },
  );

  it("links every entry to a page that exists", () => {
    for (const e of EMBEDS) {
      expect(existsSync(join(PUBLIC, ...e.href.split("/").filter(Boolean), "page.tsx")), e.href).toBe(true);
    }
  });

  it("builds a lazy, titled, borderless iframe snippet with a source link under it", () => {
    const s = embedSnippet(EMBEDS[0]!);
    expect(s).toBe(
      `<iframe src="https://permtracker.app/embed/case-status" title="Check a DOL case" width="100%" height="560" style="border:0;max-width:100%;height:max(560px,calc(900px - 51vw))" loading="lazy"></iframe>\n` +
        `<p style="margin:4px 0 0;font-size:13px">Source: <a href="https://permtracker.app/perm-case-status">PERM Tracker</a></p>`,
    );
  });

  // The processing-times box is read, never typed into, so a frame that cuts it leaves half a figure showing. Pasted
  // into a phone-width article at one fixed height it was 1,118px of content in an 840px frame (Nov 12 2026).
  describe("the processing-times box is never cut by its frame", () => {
    const box = embedBySlug("perm-processing-times")!;
    // The box's content height at each frame width, measured in Chrome on Nov 12 2026.
    const MEASURED: [frameWidth: number, contentHeight: number][] = [
      [288, 1236], [328, 1125], [358, 1118], [382, 1079], [448, 976], [520, 862], [552, 824], [600, 825],
      [640, 834], [672, 835], [688, 816], [720, 777], [800, 815], [900, 778], [1100, 758],
    ];
    // A page's gutters: a frame is at least this much narrower than the page that holds it.
    const GUTTERS = 32;

    it("writes the taller frame for a narrow page into the pasted code, after the fixed height", () => {
      expect(embedSnippet(box)).toContain(
        `width="100%" height="860" style="border:0;max-width:100%;height:max(860px,calc(1790px - 161vw))" loading="lazy">`,
      );
    });

    it.each(MEASURED)("a frame %dpx wide holds its %dpx of content with room to spare", (frameWidth, contentHeight) => {
      const frame = embedFrameHeight(box, frameWidth + GUTTERS);
      expect(frame).toBeGreaterThanOrEqual(contentHeight + 20);
      // And never so tall that a wide page shows a band of empty frame under the box.
      expect(frame - contentHeight).toBeLessThanOrEqual(110);
    });

    it("keeps one fixed height for every embed without the rule", () => {
      const plain = EMBEDS.find((e) => !e.narrow)!;
      expect(embedFrameHeight(plain, 320)).toBe(plain.height);
      expect(embedSnippet(plain)).not.toContain("height:max(");
    });
  });

  // A box somebody pastes into their own page opens whole. Each short tool's first view was measured in Chrome at
  // twenty frame widths (Nov 12 2026): at one fixed height, nine of them opened with their foot cut off on a phone,
  // and five were cut in an ordinary article column too (the case-status box by 59px at 358, the queue chart by 235px).
  describe("a short embed's first view is never cut by its frame", () => {
    const GUTTERS = 32;
    const FIRST_VIEW: Record<string, [frameWidth: number, contentHeight: number][]> = {
      "case-status": [[288, 714], [328, 647], [358, 619], [382, 619], [448, 563], [520, 543], [552, 543], [568, 543], [600, 543], [624, 543], [640, 483], [656, 483], [672, 483], [688, 483], [704, 483], [720, 483], [760, 483], [800, 483], [900, 483], [1100, 483]],
      "perm-timeline": [[288, 1298], [328, 1207], [358, 1144], [382, 1121], [448, 1006], [520, 983], [552, 983], [568, 983], [600, 963], [624, 963], [640, 1007], [656, 1007], [672, 1007], [688, 984], [704, 984], [720, 984], [760, 984], [800, 958], [900, 958], [1100, 936]],
      "perm-queue": [[288, 1247], [328, 1131], [358, 1095], [382, 1095], [448, 1042], [520, 1002], [552, 978], [568, 978], [600, 978], [624, 978], [640, 978], [656, 978], [672, 978], [688, 978], [704, 978], [720, 978], [760, 978], [800, 920], [900, 920], [1100, 920]],
      "rfi-deadline": [[288, 561], [328, 561], [358, 534], [382, 514], [448, 452], [520, 452], [552, 452], [568, 452], [600, 452], [624, 452], [640, 505], [656, 505], [672, 505], [688, 506], [704, 486], [720, 486], [760, 486], [800, 487], [900, 488], [1100, 488]],
      "pd-retention": [[288, 691], [328, 691], [358, 650], [382, 630], [448, 630], [520, 568], [552, 568], [568, 568], [600, 568], [624, 568], [640, 455], [656, 455], [672, 455], [688, 456], [704, 456], [720, 456], [760, 456], [800, 457], [900, 458], [1100, 444]],
      "h1b-six-year": [[288, 803], [328, 742], [358, 742], [382, 680], [448, 640], [520, 640], [552, 640], [568, 640], [600, 640], [624, 640], [640, 519], [656, 519], [672, 505], [688, 506], [704, 506], [720, 506], [760, 500], [800, 487], [900, 488], [1100, 488]],
      "h1b-lottery": [[288, 1321], [328, 1281], [358, 1281], [382, 1214], [448, 1214], [520, 1122], [552, 1122], [568, 1066], [600, 1066], [624, 1066], [640, 922], [656, 922], [672, 922], [688, 902], [704, 902], [720, 902], [760, 882], [800, 882], [900, 862], [1100, 778]],
      "wage-levels": [[288, 1111], [328, 1111], [358, 1064], [382, 1044], [448, 1044], [520, 972], [552, 972], [568, 972], [600, 972], [624, 972], [640, 936], [656, 936], [672, 936], [688, 936], [704, 936], [720, 864], [760, 864], [800, 864], [900, 844], [1100, 784]],
      "compare-offer": [[288, 1133], [328, 1040], [358, 1020], [382, 1020], [448, 948], [520, 928], [552, 908], [568, 908], [600, 908], [624, 908], [640, 894], [656, 894], [672, 894], [688, 894], [704, 894], [720, 894], [760, 894], [800, 722], [900, 670], [1100, 634]],
    };
    // Tools whose first view runs to several screens (a filled-in example, a long chart page). Their frame is a
    // window that scrolls, by design: a frame as tall as the content would be thousands of pixels of someone's page.
    const SCROLLS_BY_DESIGN = ["green-card-timeline", "visa-bulletin", "i485-position", "i140-trends", "priority-date", "i140-queue", "salary-explorer", "green-card-fees", "pwd-queue", "perm-deadlines"];

    for (const [slug, points] of Object.entries(FIRST_VIEW)) {
      it.each(points)(`${slug}: a frame %dpx wide holds its %dpx first view`, (frameWidth, contentHeight) => {
        const frame = embedFrameHeight(embedBySlug(slug)!, frameWidth + GUTTERS);
        expect(frame).toBeGreaterThanOrEqual(contentHeight + 20);
      });
    }

    // The queue chart is read, never typed into, so room under it is a blank band on someone's page. Its height
    // used to jump on the narrowest phones (1,467px in a 288px frame against 1,197px at 328px) because the heading
    // over a column a few pixels wide stacked a letter a line; a frame that covered that left about 250px empty on
    // every ordinary phone. With the table's phone columns fixed, one line follows it closely.
    it("the queue chart's frame follows its height on every phone: never cut, never a wide blank band", () => {
      const box = embedBySlug("perm-queue")!;
      for (const [frameWidth, contentHeight] of FIRST_VIEW["perm-queue"]!) {
        const room = embedFrameHeight(box, frameWidth + GUTTERS) - contentHeight;
        expect(room, `frame ${frameWidth}`).toBeGreaterThanOrEqual(20);
        expect(room, `frame ${frameWidth}`).toBeLessThanOrEqual(110);
      }
      expect(embedSnippet(box)).toContain("height:max(1000px,calc(1600px - 104vw))");
    });

    it("every embed is either fitted, or named as one that scrolls on purpose", () => {
      const fitted = new Set([...Object.keys(FIRST_VIEW), "perm-processing-times", "pwd-validity"]);
      for (const e of EMBEDS) {
        expect(fitted.has(e.slug) || SCROLLS_BY_DESIGN.includes(e.slug), `${e.slug} needs its first view measured`).toBe(true);
      }
    });
  });

  it("links every snippet's source line to its own full tool, outside the frame", () => {
    for (const e of EMBEDS) {
      const s = embedSnippet(e);
      const after = s.slice(s.indexOf("</iframe>"));
      expect(after, e.slug).toContain(`<a href="https://permtracker.app${e.href}">`);
    }
  });
});

describe("the site key", () => {
  it.each([
    ["https://www.Example.com/some/page?x=1", "example.com"],
    ["https://blog.example.co.uk/", "blog.example.co.uk"],
    ["example.org", "example.org"],
    ["localhost", "unknown"],
    ['x"; DROP', "unknown"],
    ["", "unknown"],
    [null, "unknown"],
    [`https://${"a".repeat(120)}.com/`, "unknown"],
    ["a..b.com", "unknown"],
    ["example.com.", "unknown"],
  ])("siteKeyOf(%j) is %s", (raw, key) => {
    expect(siteKeyOf(raw)).toBe(key);
  });

  it("takes the embedding page from the Referer, and the carried field only from our own pages", () => {
    expect(embedSiteFor("https://lawfirm.example/perm/", "spoof.example")).toBe("lawfirm.example");
    expect(embedSiteFor("https://permtracker.app/embed/case-status?case=x", "lawfirm.example")).toBe("lawfirm.example");
    expect(embedSiteFor(null, "lawfirm.example")).toBe("lawfirm.example");
    expect(embedSiteFor(null, null)).toBe("unknown");
  });
});

describe("EmbedFrame", () => {
  it("refuses a slug that could break out of its style rule", () => {
    expect(() => embedCss('x"] { } body { display:none } [x="')).toThrow();
  });

  it("never lets an embed be indexed, and points it at the full tool", () => {
    const m = embedMetadata("rfi-deadline");
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.alternates?.canonical).toBe("/tools/rfi-deadline");
  });

  it("renders the real tool with its marker, the hiding rule and the attribution link", () => {
    const html = renderToStaticMarkup(
      <EmbedFrame slug="rfi-deadline">
        <RfiDeadlinePage />
      </EmbedFrame>,
    );
    expect(html).toContain('data-embed="rfi-deadline"');
    expect(html).toContain(':has([data-embed~="rfi-deadline"])');
    expect(html).toMatch(/href="\/tools\/rfi-deadline"[^>]*>Open the full tool on PERM Tracker/);
  });
});

describe("the gallery on /badges", () => {
  it("offers every embed with its exact snippet and a preview, and one live frame", () => {
    const html = renderToStaticMarkup(<EmbedGallery origin="https://permtracker.app" />);
    for (const e of EMBEDS) {
      // React escapes the snippet's quotes and angle brackets inside <code>.
      const shown = embedSnippet(e).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      expect(html, e.slug).toContain(shown);
    }
    expect(html.match(/<iframe /g)).toHaveLength(1);
    expect(html).toContain('src="/embed/case-status"');
    expect(html.match(/Preview the frame/g)).toHaveLength(EMBEDS.length - 1);
  });
});
