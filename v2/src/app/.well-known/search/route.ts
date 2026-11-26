/**
 * The site's search for AI agents: `GET /.well-known/search?q=...` answers in Markdown with the pages, employers, law
 * firms and articles that match, each with its address, read live (the pages and articles from the site's own index,
 * the employers and firms from DOL's records). Agents find it from the agent:* meta tags every page carries, the
 * convention Cloudflare's Search for Agents uses, so they can search here instead of crawling. It returns links and
 * one line each, never a written answer: the agent reads the page it picks.
 */

import { getAllPosts } from "@/lib/content";
import { searchNameOrLetters } from "@/lib/db/entities";
import { entityHref } from "@/lib/entityPayload";
import { matchScore } from "@/lib/search/paletteRank";
import { SEARCH_TEXT_MAX } from "@/lib/search/limits";
import { staticIndex } from "@/lib/search/siteIndex";
import { softFail } from "@/lib/softRead";
import { SITE_URL } from "@/lib/constants/site";

const PAGES_SHOWN = 6;
const NAMES_SHOWN = 5;
const ARTICLES_SHOWN = 5;
const HEADERS = { "Content-Type": "text/markdown; charset=utf-8", "X-Robots-Tag": "noindex", "Cache-Control": "public, max-age=300" };

const n = (x: number) => x.toLocaleString("en-US");

function best<T>(q: string, rows: readonly T[], name: (r: T) => { name: string; aliases?: readonly string[]; keywords?: string }, k: number): T[] {
  return rows
    .map((r) => ({ r, s: matchScore(q, name(r)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.r);
}

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("q") ?? "";
  // The length cap first, before any matching (a long string costs every step after it).
  if (raw.length > SEARCH_TEXT_MAX * 2) {
    return new Response(`A query of ${SEARCH_TEXT_MAX} characters or fewer, please.\n`, { status: 400, headers: HEADERS });
  }
  const q = raw.trim().slice(0, SEARCH_TEXT_MAX);
  if (!q) {
    return new Response("Add what to look for: /.well-known/search?q=your+words\n", { status: 400, headers: HEADERS });
  }
  const pages = best(q, staticIndex(), (p) => ({ name: p.label, aliases: p.aliases, keywords: p.keywords }), PAGES_SHOWN);
  const articles = best(q, getAllPosts(), (p) => ({ name: p.meta.title }), ARTICLES_SHOWN);
  const [employers, firms] = await Promise.all([
    searchNameOrLetters("employer", q, NAMES_SHOWN).catch(softFail("wellKnownSearch.employers", [])),
    searchNameOrLetters("attorney", q, NAMES_SHOWN).catch(softFail("wellKnownSearch.firms", [])),
  ]);

  const out: string[] = [`# Search results for: "${q.replace(/"/g, "'")}"`, ""];
  const section = (title: string, lines: string[]) => {
    if (lines.length) out.push(`## ${title}`, "", ...lines, "");
  };
  section("Pages", pages.map((p) => `- [${p.label}](${SITE_URL}${p.href})`));
  section(
    "Employers (PERM cases DOL has decided)",
    employers.slice(0, NAMES_SHOWN).map((e) => `- [${e.name}](${SITE_URL}${entityHref("employer", e.slug)}): ${n(e.total)} decided, ${n(e.certified)} certified`),
  );
  section(
    "Law firms (PERM cases DOL has decided)",
    firms.slice(0, NAMES_SHOWN).map((e) => `- [${e.name}](${SITE_URL}${entityHref("attorney", e.slug)}): ${n(e.total)} decided, ${n(e.certified)} certified`),
  );
  section("Articles", articles.map((p) => `- [${p.meta.title}](${SITE_URL}/${p.type}/${p.slug})`));
  if (out.length === 2) out.push("Nothing on PERM Tracker matched. Try fewer or different words.", "");
  return new Response(out.join("\n"), { status: 200, headers: HEADERS });
}
