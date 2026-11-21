/**
 * The rules every JSON-LD node the site emits is held to, in one place: the vitest gate
 * (src/lib/__tests__/structured-data-gate.test.ts) runs them on every builder and every page's own literals, and
 * scripts/audit_page_markup.py runs the same rules on rendered pages each morning.
 *
 * 1. Every property is one schema.org allows on the node's type. The list per type is
 *    scripts/data/schema_org_properties.json, read from each type's own page on schema.org
 *    (scripts/schema_vocab.py). A type missing from that file fails too, so a new type is read before it ships.
 * 2. Every rich type carries what Google requires of it, from Google's own feature pages (read Nov 20 2026):
 *    - SoftwareApplication and its WebApplication and MobileApplication: name, offers.price, and aggregateRating
 *      or review (developers.google.com/search/docs/appearance/structured-data/software-app).
 *    - AggregateRating: ratingValue, and ratingCount or reviewCount (.../review-snippet).
 *    - Dataset: name, and a description of 50 to 5,000 characters (.../dataset).
 *    - BreadcrumbList: itemListElement, each ListItem with position and name, and item on all but the last
 *      (.../breadcrumb).
 *    - VideoObject: name, thumbnailUrl, uploadDate (.../video).
 *    - FAQPage: Google dropped the result in May 2026 and removed its page; other engines read it, so the shape that
 *      page asked for stays: each Question named, with an acceptedAnswer that has text.
 *    - Article and its kinds: Google requires nothing (.../article: "There are no required properties"). We hold
 *      headline, author and datePublished, three of its recommended ones, so a long read is never a bare type.
 *    - The site's Organization node: logo and url. Google's Organization page requires nothing and recommends both;
 *      they're the pair its old Logo feature required, and the one node every page carries keeps them.
 * 3. No two full nodes on one page share an `@id`. A node is full when it says anything beyond its `@id` and
 *    `@type`; `{ "@id": X }` is a reference and may repeat. Parsers that don't merge by `@id` (validator.schema.org,
 *    Google's per-item check, Ahrefs) read two full nodes as two things, and one of them was a SoftwareApplication
 *    missing its rating on every page (Nov 20 2026).
 */

import vocabulary from "../../../scripts/data/schema_org_properties.json";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Node = { [k: string]: Json };

const TYPES = (vocabulary as { types: Record<string, { properties: string[] }> }).types;

export const APP_TYPES = new Set(["SoftwareApplication", "WebApplication", "MobileApplication", "VideoGame"]);
export const ARTICLE_TYPES = new Set(["Article", "TechArticle", "NewsArticle", "BlogPosting", "ScholarlyArticle", "Report"]);
const SITE_ORG_ID = /\/#organization$/;

/** The properties schema.org allows on a node of these types; null when a type isn't in the vocabulary file. */
export function allowedProperties(types: readonly string[]): Set<string> | null {
  const out = new Set<string>();
  for (const t of types) {
    const entry = TYPES[t];
    if (!entry) return null;
    for (const p of entry.properties) out.add(p);
  }
  return out;
}

function typesOf(node: Node): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

const isNode = (v: Json | undefined): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const asList = (v: Json | undefined): Json[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const present = (v: Json | undefined) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
const label = (node: Node) => `${typesOf(node).join("/") || "node"}${typeof node["@id"] === "string" ? ` ${node["@id"]}` : ""}`;

/** Whether a node says anything beyond who it is: a full node, as against a reference. */
export function isFullNode(node: Node): boolean {
  return Object.keys(node).some((k) => k !== "@id" && k !== "@type" && k !== "@context");
}

/** Google's required properties for the rich types (rule 2). `parentKey` is the property this node is the value of. */
export function googleRequired(node: Node, parentKey: string | null): string[] {
  const types = typesOf(node);
  const has = (t: string) => types.includes(t);
  const out: string[] = [];
  const need = (key: string, why: string) => {
    if (!present(node[key])) out.push(`${label(node)}: no ${key} (${why})`);
  };
  if (types.some((t) => APP_TYPES.has(t)) && isFullNode(node)) {
    need("name", "Google's Software App feature requires it");
    const offers = asList(node.offers).filter(isNode);
    if (offers.length === 0 || offers.some((o) => o.price === undefined || o.price === null || o.price === "")) {
      out.push(`${label(node)}: no offers.price (Google's Software App feature requires it)`);
    }
    if (!present(node.aggregateRating) && !present(node.review)) {
      out.push(`${label(node)}: no aggregateRating or review (Google's Software App feature requires one)`);
    }
  }
  if (has("AggregateRating")) {
    need("ratingValue", "Google's review snippet requires it");
    if (!present(node.ratingCount) && !present(node.reviewCount)) {
      out.push(`${label(node)}: no ratingCount or reviewCount (Google's review snippet requires one)`);
    }
    if (parentKey !== "aggregateRating") need("itemReviewed", "a rating not nested in its item names the item");
  }
  if (has("Dataset")) {
    need("name", "Google's Dataset feature requires it");
    const d = node.description;
    if (typeof d !== "string" || d.length < 50 || d.length > 5000) {
      out.push(`${label(node)}: description must be 50 to 5,000 characters (Google's Dataset feature)`);
    }
  }
  if (has("BreadcrumbList")) {
    const items = asList(node.itemListElement).filter(isNode);
    if (items.length === 0) out.push(`${label(node)}: no itemListElement (Google's breadcrumb feature requires it)`);
    items.forEach((it, i) => {
      if (typeof it.position !== "number") out.push(`${label(node)}: breadcrumb ${i + 1} has no numeric position`);
      if (!present(it.name) && !(isNode(it.item) && present(it.item.name))) out.push(`${label(node)}: breadcrumb ${i + 1} has no name`);
      if (i < items.length - 1 && !present(it.item)) out.push(`${label(node)}: breadcrumb ${i + 1} has no item (only the last may omit it)`);
    });
  }
  if (has("VideoObject")) {
    need("name", "Google's video feature requires it");
    need("thumbnailUrl", "Google's video feature requires it");
    need("uploadDate", "Google's video feature requires it");
  }
  if (has("FAQPage")) {
    const qs = asList(node.mainEntity).filter(isNode);
    if (qs.length === 0) out.push(`${label(node)}: no questions in mainEntity`);
    qs.forEach((q, i) => {
      const a = q.acceptedAnswer;
      if (!present(q.name) || !isNode(a) || !present(a.text)) out.push(`${label(node)}: question ${i + 1} lacks its name or its answer's text`);
    });
  }
  if (types.some((t) => ARTICLE_TYPES.has(t)) && isFullNode(node)) {
    need("headline", "recommended by Google, held here");
    need("datePublished", "recommended by Google, held here");
    const authors = asList(node.author);
    if (authors.length === 0 || authors.some((a) => !(isNode(a) && (present(a.name) || present(a["@id"]))))) {
      out.push(`${label(node)}: no author with a name (recommended by Google, held here)`);
    }
  }
  if (has("Organization") && typeof node["@id"] === "string" && SITE_ORG_ID.test(node["@id"]) && isFullNode(node)) {
    need("logo", "the site's Organization keeps its logo");
    need("url", "the site's Organization keeps its url");
  }
  return out;
}

/** Every rule (1 to 3) over one page's JSON-LD: the parsed contents of each of its ld+json scripts. */
export function checkJsonLd(blocks: readonly unknown[]): string[] {
  const problems: string[] = [];
  const fullIds = new Map<string, string>();

  const visit = (value: Json, parentKey: string | null) => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v, parentKey);
      return;
    }
    if (!isNode(value)) return;
    const types = typesOf(value);
    if (types.length > 0) {
      const allowed = allowedProperties(types);
      if (!allowed) {
        const missing = types.filter((t) => !TYPES[t]);
        problems.push(`${label(value)}: ${missing.join(", ")} isn't in scripts/data/schema_org_properties.json (read it with scripts/schema_vocab.py --add)`);
      } else {
        for (const key of Object.keys(value)) {
          if (key.startsWith("@")) continue;
          if (!allowed.has(key)) problems.push(`${label(value)}: ${key} isn't a schema.org property of ${types.join(" or ")}`);
        }
      }
      problems.push(...googleRequired(value, parentKey));
    }
    const id = value["@id"];
    if (typeof id === "string" && isFullNode(value)) {
      const seen = fullIds.get(id);
      if (seen) problems.push(`two full nodes share the @id ${id} (${seen} and ${label(value)}); make one a reference`);
      else fullIds.set(id, label(value));
    }
    for (const [k, v] of Object.entries(value)) {
      if (k === "@context") continue;
      visit(v, k === "@graph" ? null : k);
    }
  };

  for (const block of blocks) visit(block as Json, null);
  return problems;
}
