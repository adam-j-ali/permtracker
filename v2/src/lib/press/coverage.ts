/**
 * Stories that used the site's figures, one entry each, and the pages whose figures they used. A page shows each one
 * near its source line (CitedBy) and names it in its structured data (coverageSchema). Each entry links the story at
 * its own outlet, never a copy on an aggregator, and only once the story is published.
 */
export interface Coverage {
  /** The outlet as it names itself. */
  outlet: string;
  /** The story's headline, as published. */
  story: string;
  /** The link's words: what the story is about, so the link says where it goes. */
  about: string;
  href: string;
  /** The day it was published, Eastern (YYYY-MM-DD). */
  published: string;
  /** The site's pages whose figures the story used. */
  pages: readonly string[];
}

export const COVERAGE: readonly Coverage[] = [
  {
    outlet: "International Business Times",
    story:
      "Microsoft's Green Card Filings Reveal A Striking Pattern After Mass Layoffs. Trump's New Rule Could Freeze Sponsorships For Two Years.",
    about: "its story on green card filings at Microsoft after the company's 2025 layoffs",
    href: "https://www.ibtimes.com/microsoft-green-card-filings-after-2025-layoffs-3810211",
    published: "2026-11-25",
    pages: ["/perm-layoff-disclosures", "/perm-employers/under-review"],
  },
];

/** The stories that used a page's figures, newest first. */
export function coverageOf(path: string): Coverage[] {
  return COVERAGE.filter((c) => c.pages.includes(path)).sort((a, b) => b.published.localeCompare(a.published));
}

/** A story as schema.org reads it: a news article about the page's data (a Dataset's `subjectOf`). */
export function coverageSchema(c: Coverage) {
  return {
    "@type": "NewsArticle",
    headline: c.story,
    url: c.href,
    datePublished: c.published,
    // The outlet stands as the author: a reporter's name never goes in this public repository.
    author: { "@type": "NewsMediaOrganization", name: c.outlet },
    publisher: { "@type": "NewsMediaOrganization", name: c.outlet },
  };
}
