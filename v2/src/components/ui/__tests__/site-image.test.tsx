// @vitest-environment jsdom
/**
 * Every picture's address carries three query parameters (url, w, q), the same from one deploy to the next.
 *
 * With a deployment id set, Next's own loader adds a fourth, `dpl`, to every optimized image's address. Ahrefs
 * counted 133 such addresses (Nov 20 2026), and since the id changes each night, each deploy also gave every picture
 * a new address for search engines to fetch again. SiteImage builds the address without it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { stableImageLoader } from "@/lib/imageLoader";

const DPL = "dpl-under-test";
const ROOT = join(__dirname, "..", "..", "..", "..");
const params = (url: string) => [...new URL(url, "https://permtracker.app").searchParams.keys()];
const srcsetUrls = (srcset: string | null) => (srcset ?? "").split(",").map((p) => p.trim().split(" ")[0]!).filter(Boolean);

describe("the image loader", () => {
  it("writes url, w and q, and nothing else", () => {
    const url = stableImageLoader({ src: "/images/content/heroes/guides/a.webp", width: 640, quality: 75 });
    expect(url).toBe("/_next/image?url=%2Fimages%2Fcontent%2Fheroes%2Fguides%2Fa.webp&w=640&q=75");
  });

  it("drops a deploy's dpl that a static import's address carries", () => {
    const url = stableImageLoader({ src: `/_next/static/media/a.1234.webp?dpl=${DPL}`, width: 256 });
    expect(params(url)).toEqual(["url", "w", "q"]);
    expect(url).not.toContain(DPL);
    expect(decodeURIComponent(url)).toContain("/_next/static/media/a.1234.webp&");
  });

  it("asks for a quality the image server accepts (Next's default list, 75)", () => {
    expect(stableImageLoader({ src: "/a.png", width: 384, quality: 95 })).toMatch(/&q=75$/);
    expect(stableImageLoader({ src: "/a.png", width: 384 })).toMatch(/&q=75$/);
  });

  it("passes another site's picture through the image server as Next does", () => {
    expect(stableImageLoader({ src: "https://upload.wikimedia.org/a.jpg", width: 828 })).toBe(
      "/_next/image?url=https%3A%2F%2Fupload.wikimedia.org%2Fa.jpg&w=828&q=75",
    );
  });
});

describe("SiteImage, with a deployment id set", () => {
  let NextImage: typeof import("next/image").default;
  let SiteImage: typeof import("../site-image").SiteImage;
  beforeAll(async () => {
    // Next reads the id once, from the page's <html data-dpl-id>, when its image module loads.
    document.documentElement.dataset.dplId = DPL;
    NextImage = (await import("next/image")).default;
    SiteImage = (await import("../site-image")).SiteImage;
  });

  it("the probe: Next's own loader puts dpl, a fourth parameter, on every address", () => {
    const { container } = render(<NextImage src="/images/a.webp" alt="A" width={1200} height={675} />);
    const img = container.querySelector("img")!;
    expect(params(img.getAttribute("src")!)).toContain("dpl");
  });

  it("writes every address in src and srcset with three parameters and no dpl", () => {
    const { container } = render(<SiteImage src="/images/a.webp" alt="A" width={1200} height={675} sizes="100vw" />);
    const img = container.querySelector("img")!;
    const urls = [img.getAttribute("src")!, ...srcsetUrls(img.getAttribute("srcset"))];
    expect(urls.length).toBeGreaterThan(3);
    for (const u of urls) expect(params(u)).toEqual(["url", "w", "q"]);
    expect(img.getAttribute("alt")).toBe("A");
  });

  it("serves an SVG from its own address, as Next does for its own loader, never through the image server", () => {
    const { container } = render(<SiteImage src="/icons/a.svg" alt="" width={24} height={24} />);
    const src = container.querySelector("img")!.getAttribute("src")!;
    expect(src.startsWith("/icons/a.svg")).toBe(true);
    expect(params(src).length).toBeLessThanOrEqual(1);
  });
});

describe("every picture on the site", () => {
  it("goes through SiteImage: no file but its own imports next/image", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__" && name !== "node_modules") walk(p);
        } else if (
          /\.tsx?$/.test(name) &&
          !/\.(test|stories)\.tsx?$/.test(name) &&
          // A type-only import draws nothing.
          /^import (?!type\b)[^;]*from ["']next\/(legacy\/)?image["']/m.test(readFileSync(p, "utf8"))
        ) {
          hits.push(relative(ROOT, p));
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(hits).toEqual(["src/components/ui/site-image.tsx"]);
  });
});
