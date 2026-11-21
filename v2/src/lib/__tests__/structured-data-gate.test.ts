/**
 * Every JSON-LD node the site emits, held to the rules in src/lib/seo/jsonLdCheck.ts: each property allowed on its
 * type by schema.org (scripts/data/schema_org_properties.json, read from each type's page), Google's required
 * properties on each rich type, and no two full nodes sharing an `@id` on one page.
 *
 * Three layers, because no one of them sees everything:
 * - the shared builders, built and checked whole, and composed as the pages compose them (the root layout's graph
 *   on every page, the homepage's own nodes on top);
 * - every object literal with a literal `@type` in the source (each page family's own nodes, which need the
 *   database to render), checked for its property names and, where nothing is spread into it, its required keys;
 * - the rendered pages, by scripts/audit_page_markup.py each morning (page_checks.py, "markup").
 *
 * Found Nov 20 2026 by Ahrefs on every page: `verificationFactCheckingPolicy` on Organization (schema.org has it on
 * NewsMediaOrganization only) and a site-wide SoftwareApplication with no rating (Google's Software App feature
 * requires aggregateRating or review), whose rating sat in a second node with the same @id that validators don't merge.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { breadcrumbSchema } from "@/lib/breadcrumbs";
import {
  generateArticleSchema,
  generateBreadcrumbSchema,
  generateHowToSchema,
  generateItemListSchema,
  generateVideoObjectSchema,
} from "@/lib/content/seo";
import type { PostMeta, PostSummary } from "@/lib/content/types";
import { DATE_SOURCE, OWN_PAGE_NODE } from "@/lib/pageDates";
import { allowedProperties, APP_TYPES, ARTICLE_TYPES, checkJsonLd } from "@/lib/seo/jsonLdCheck";
import {
  APP_RATING,
  getDatasetSchema,
  getFAQPageSchema,
  getLongReadSchema,
  getOrganizationSchema,
  getSiteGraph,
  getSoftwareApplicationSchema,
  getWebSiteSchema,
  LONG_READS,
  SCHEMA_IDS,
} from "@/lib/structuredData";

const BASE = "https://permtracker.app";
const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

const META: PostMeta = {
  title: "How long PERM takes",
  description: "What DOL's queue says about the wait for a PERM decision, month by month.",
  date: "2026-10-01",
  updated: "2026-11-01",
  author: "PERM Tracker Team",
  image: "/images/content/heroes/guides/perm-timeline.webp",
  tags: ["perm", "timeline"],
  readingTime: "5 min read",
  published: true,
};

const SUMMARY = { slug: "perm-timeline", type: "guides", meta: META } as unknown as PostSummary;

describe("the rules fire on what they exist to catch (probes)", () => {
  it("a property schema.org doesn't allow on the type", () => {
    const org = { "@type": "Organization", name: "X", url: BASE, verificationFactCheckingPolicy: `${BASE}/methodology` };
    expect(checkJsonLd([org]).join("\n")).toMatch(/verificationFactCheckingPolicy isn't a schema.org property of Organization/);
  });

  it("a SoftwareApplication without a rating, and a WebApplication without one", () => {
    const app = { "@type": "SoftwareApplication", name: "PERM Tracker", offers: { "@type": "Offer", price: "0" } };
    expect(checkJsonLd([app]).join("\n")).toMatch(/no aggregateRating or review/);
    expect(checkJsonLd([{ ...app, "@type": "WebApplication" }]).join("\n")).toMatch(/no aggregateRating or review/);
  });

  it("two full nodes with one @id, though a reference may repeat", () => {
    const a = { "@type": "Organization", "@id": `${BASE}/#organization`, name: "A", url: BASE, logo: `${BASE}/icon-512.png` };
    expect(checkJsonLd([a, { ...a, name: "B" }]).join("\n")).toMatch(/two full nodes share the @id/);
    expect(checkJsonLd([a, { "@id": a["@id"] }])).toEqual([]);
  });

  it("a type the vocabulary file doesn't hold", () => {
    expect(checkJsonLd([{ "@type": "Recipe", name: "x" }]).join("\n")).toMatch(/Recipe isn't in scripts\/data/);
  });

  it("a Dataset whose description Google would refuse, and a breadcrumb missing its item", () => {
    expect(checkJsonLd([{ "@type": "Dataset", name: "x", description: "short" }]).join("\n")).toMatch(/50 to 5,000/);
    const crumbs = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home" },
        { "@type": "ListItem", position: 2, name: "Here" },
      ],
    };
    expect(checkJsonLd([crumbs]).join("\n")).toMatch(/breadcrumb 1 has no item/);
  });
});

describe("the cases both validators share (scripts/fixtures/jsonld_cases.json)", () => {
  const { cases } = JSON.parse(readFileSync(join(ROOT, "scripts", "fixtures", "jsonld_cases.json"), "utf8")) as {
    cases: { name: string; blocks: unknown[]; expect: string[] }[];
  };
  it("holds cases", () => expect(cases.length).toBeGreaterThan(10));
  for (const c of cases) {
    it(c.name, () => {
      const got = checkJsonLd(c.blocks);
      if (c.expect.length === 0) expect(got).toEqual([]);
      for (const piece of c.expect) expect(got.some((p) => p.includes(piece)), `${piece} in ${JSON.stringify(got)}`).toBe(true);
      expect(got.length).toBeGreaterThanOrEqual(c.expect.length);
    });
  }
});

describe("the shared builders", () => {
  const built: Record<string, unknown> = {
    "the root layout's graph": getSiteGraph(BASE),
    "Organization": getOrganizationSchema(BASE),
    "WebSite": getWebSiteSchema(BASE),
    "FAQPage": getFAQPageSchema([{ question: "What is PERM?", answer: "The labor certification DOL decides." }]),
    "the app, with its rating": getSoftwareApplicationSchema(BASE, APP_RATING),
    "Dataset": getDatasetSchema(BASE, {
      name: "PERM filings by employer",
      description: "Every PERM filing in DOL's disclosure files, counted by employer and fiscal year.",
      url: `${BASE}/perm-employers`,
      temporalCoverage: "2019-10-01/2026-09-30",
      distribution: [{ encodingFormat: "text/csv", contentUrl: `${BASE}/open-data/perm.csv` }],
    }),
    "Article": generateArticleSchema(META, "perm-timeline", "guides"),
    "HowTo": generateHowToSchema(META, "perm-timeline", [{ name: "File", text: "File the ETA 9089." }]),
    "BreadcrumbList (content)": generateBreadcrumbSchema([
      { name: "Home", href: "/" },
      { name: "Guides", href: "/guides" },
    ]),
    "BreadcrumbList (site)": breadcrumbSchema("/perm-employers/google-llc", "Google LLC"),
    "VideoObject": generateVideoObjectSchema("/videos/how.mp4", "How the lookup works", META),
    "ItemList": generateItemListSchema([SUMMARY], "guides"),
    "TechArticle (a long read)": getLongReadSchema(BASE, {
      path: "/methodology",
      headline: "How PERM Tracker's Estimates Work",
      description: "Where every figure comes from.",
      datePublished: "2026-08-25",
      dateModified: "2026-11-10",
      image: `${BASE}/cards/methodology.jpg`,
    }),
  };

  for (const [name, schema] of Object.entries(built)) {
    it(`${name} passes every rule`, () => {
      expect(checkJsonLd([schema])).toEqual([]);
    });
  }

  it("the root layout's graph carries no SoftwareApplication: the app's full node ships only where its rating is", () => {
    const graph = getSiteGraph(BASE)["@graph"] as Array<{ "@type": string; "@id": string }>;
    expect(graph.map((n) => n["@type"])).not.toContain("SoftwareApplication");
    expect(graph.map((n) => n["@id"])).not.toContain(SCHEMA_IDS.software(BASE));
  });

  it("the homepage's nodes on top of the layout's share no @id with them", () => {
    const home = [getSiteGraph(BASE), getFAQPageSchema([{ question: "Q?", answer: "A." }]), getSoftwareApplicationSchema(BASE, APP_RATING)];
    expect(checkJsonLd(home)).toEqual([]);
  });

  it("the long reads carry an Article kind, and only the long reads: never a tool, a list or a calculator", () => {
    const callers = sourceFilesCalling("getLongReadSchema")
      .map((f) => relative(ROOT, f))
      .filter((f) => f !== "src/lib/structuredData.ts");
    expect(callers).toEqual(LONG_READS.map((r) => `src/app/(site)/(public)${r}/page.tsx`));
    for (const f of callers) expect(f).not.toMatch(/\/tools\/|calculator|-cases\/|employers|attorneys/);
  });

  it("a long read's node on top of the layout's and the page's own WebPage shares no @id with them", () => {
    const long = getLongReadSchema(BASE, {
      path: "/methodology",
      headline: "How PERM Tracker's Estimates Work",
      description: "Where every figure comes from.",
      datePublished: "2026-08-25",
      dateModified: "2026-11-10",
    });
    const webPage = { "@type": "WebPage", "@id": `${BASE}/methodology#webpage`, url: `${BASE}/methodology`, dateModified: "2026-11-10" };
    expect(checkJsonLd([getSiteGraph(BASE), long, webPage])).toEqual([]);
  });

  it("an article page's nodes on top of the layout's share no @id with them", () => {
    const page = [getSiteGraph(BASE), generateArticleSchema(META, "perm-timeline", "guides"), breadcrumbSchema("/guides/perm-timeline", META.title)];
    expect(checkJsonLd(page)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Each page family's own nodes, read from the source
// ---------------------------------------------------------------------------

/** Every non-test source file that writes a `@type`. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec|stories)\.tsx?$/.test(name) && /["']@type["']/.test(readFileSync(p, "utf8"))) {
      out.push(p);
    }
  }
  return out;
}

interface Literal {
  file: string;
  line: number;
  type: string;
  keys: string[];
  /** A spread or a computed key: the literal's whole shape isn't readable here. */
  open: boolean;
}

function literalString(e: ts.Expression): string | null {
  let x: ts.Expression = e;
  while (ts.isAsExpression(x) || ts.isParenthesizedExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression;
  return ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) ? x.text : null;
}

function propName(n: ts.PropertyName): string | null {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  if (ts.isComputedPropertyName(n)) return literalString(n.expression);
  return null;
}

function typedLiterals(file: string): Literal[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Literal[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      let type: string | null = null;
      const keys: string[] = [];
      let open = false;
      for (const p of node.properties) {
        if (ts.isSpreadAssignment(p)) {
          open = true;
          continue;
        }
        if (ts.isShorthandPropertyAssignment(p)) {
          keys.push(p.name.text);
          continue;
        }
        if (!ts.isPropertyAssignment(p) && !ts.isMethodDeclaration(p)) continue;
        const name = propName(p.name);
        if (name === null) {
          open = true;
          continue;
        }
        if (name === "@type" && ts.isPropertyAssignment(p)) type = literalString(p.initializer);
        keys.push(name);
      }
      if (type) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        out.push({ file: relative(ROOT, file), line: line + 1, type, keys, open });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
}

/** The keys Google requires on a rich type, as key names (a literal can't show its values here). */
function requiredKeys(type: string, keys: readonly string[]): string[] {
  const has = (k: string) => keys.includes(k);
  const missing: string[] = [];
  const need = (...ks: string[]) => ks.forEach((k) => !has(k) && missing.push(k));
  if (APP_TYPES.has(type)) {
    need("name", "offers");
    if (!has("aggregateRating") && !has("review")) missing.push("aggregateRating or review");
  }
  if (ARTICLE_TYPES.has(type)) need("headline", "author", "datePublished");
  if (type === "Dataset") need("name", "description");
  if (type === "BreadcrumbList") need("itemListElement");
  if (type === "VideoObject") need("name", "thumbnailUrl", "uploadDate");
  if (type === "FAQPage") need("mainEntity");
  if (type === "AggregateRating") {
    need("ratingValue");
    if (!has("ratingCount") && !has("reviewCount")) missing.push("ratingCount or reviewCount");
  }
  return missing;
}

describe("each page family's own nodes, read from the source", () => {
  const files = sourceFiles(SRC);
  const literals = files.flatMap(typedLiterals);

  it("finds the files that build nodes (a scan that sees nothing would pass anything)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(literals.length).toBeGreaterThan(100);
  });

  it("every literal's properties are ones schema.org allows on its type", () => {
    const problems: string[] = [];
    for (const l of literals) {
      const allowed = allowedProperties([l.type]);
      if (!allowed) {
        problems.push(`${l.file}:${l.line} ${l.type} isn't in scripts/data/schema_org_properties.json`);
        continue;
      }
      for (const k of l.keys) if (!k.startsWith("@") && !allowed.has(k)) problems.push(`${l.file}:${l.line} ${l.type}.${k}`);
    }
    expect(problems).toEqual([]);
  });

  it("every whole literal of a rich type carries Google's required keys", () => {
    const problems = literals
      .filter((l) => !l.open)
      .flatMap((l) => requiredKeys(l.type, l.keys).map((k) => `${l.file}:${l.line} ${l.type} has no ${k}`));
    expect(problems).toEqual([]);
  });

  it("a page that writes its own #webpage node is one the breadcrumb bar leaves it to, dated as the bar dates it", () => {
    // The bar (SiteBreadcrumbs) writes `<url>#webpage` on every page; a page writing its own would be a second full
    // node with that @id (/about's AboutPage was, until Nov 20 2026).
    const pages = sourceFiles(join(SRC, "app"))
      .filter((f) => f.endsWith("page.tsx") && /["']@id["']\s*:\s*`[^`]*#webpage`/.test(readFileSync(f, "utf8")))
      .map((f) => relative(join(SRC, "app"), f).replace(/\/page\.tsx$/, "").replace(/\([^)]*\)\//g, ""))
      .map((r) => `/${r}`);
    expect(pages).toEqual([...OWN_PAGE_NODE]);
    // The page dates its node from the code alone, so the bar's day must come from the code alone too.
    for (const route of OWN_PAGE_NODE) expect(DATE_SOURCE[route]).toBeUndefined();
  });

  it("the app's full node is built in one place, and only the homepage calls it", () => {
    const apps = literals.filter((l) => APP_TYPES.has(l.type));
    expect(apps.map((l) => l.file)).toEqual(["src/lib/structuredData.ts"]);
    const callers = sourceFilesCalling("getSoftwareApplicationSchema")
      .map((f) => relative(ROOT, f))
      .filter((f) => f !== "src/lib/structuredData.ts");
    expect(callers).toEqual(["src/app/(site)/(public)/page.tsx"]);
  });
});

/** Files under src that call a function, whether or not they write a `@type` themselves. */
function sourceFilesCalling(fn: string, dir: string = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFilesCalling(fn, p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec|stories)\.tsx?$/.test(name) && readFileSync(p, "utf8").includes(`${fn}(`)) {
      out.push(p);
    }
  }
  return out;
}
