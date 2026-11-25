/**
 * The hub of every family of generated pages: the page whose HTML links each page of the family.
 *
 * The sitemap gets a page discovered, but a crawler reaches and weighs a page by its links, and several AI crawlers
 * read no sitemap at all. A family with no hub is a set of orphans: the 3,726 job title pages were, until Nov 2026
 * (Ahrefs found 3,713 linked from nothing it crawled). `__tests__/family-hubs.test.ts` holds every [param] route
 * under (public) to this list or to UNLISTED_FAMILIES, checks each hub exists, and asks for the test that proves the
 * hub links every page, or for what it still owes, written here where the next person will read it.
 */

export interface FamilyHub {
  /** The page linking the family: a page of fixed address, or a family that has a hub itself (a letter page). */
  hub: string;
  /** The test that renders the hub's links and fails on a page left out, and words it must contain. */
  proof?: { test: string; mark: string };
  /** What the hub doesn't link yet, measured, when it doesn't link every page. */
  owed?: string;
}

const CONTENT_PROOF = { test: "src/components/content/__tests__/ContentListing.ssr.test.tsx", mark: "links every article from the server's HTML" };
const LETTERS_PROOF = { test: "src/components/entities/__tests__/EntityBrowse.test.tsx", mark: "BrowseIndexGrid" };
/** The group indexes page their table in the browser, so the server's HTML holds the first page and the top twelve. */
const GROUP_OWED =
  "The index's table pages its rows in the browser (FilterableStatTable), so its HTML links the first page of rows and the twelve busiest; the rest are reached from employer, occupation and other pages.";
const UNTESTED = "A test that renders the hub and checks every page the sitemap lists is a link on it.";

export const FAMILY_HUBS: Readonly<Record<string, FamilyHub>> = {
  "/blog/[slug]": { hub: "/blog", proof: CONTENT_PROOF },
  "/guides/[slug]": { hub: "/guides", proof: CONTENT_PROOF },
  "/changelog/[slug]": { hub: "/changelog", proof: CONTENT_PROOF },

  "/soc-codes/[title]": {
    hub: "/soc-codes/browse/[letter]",
    proof: { test: "src/app/__tests__/sitemap.test.ts", mark: "links every job title it lists from a letter page it also lists" },
  },
  "/soc-codes/browse/[letter]": {
    hub: "/soc-codes",
    proof: { test: "src/components/soc/__tests__/TitleBrowse.test.tsx", mark: "TitleLetterStrip" },
  },

  "/perm-employers/browse/[letter]": { hub: "/perm-employers/browse", proof: LETTERS_PROOF },
  "/perm-attorneys/browse/[letter]": { hub: "/perm-attorneys/browse", proof: LETTERS_PROOF },
  "/perm-wages/browse/[letter]": { hub: "/perm-wages/browse", proof: LETTERS_PROOF },
  "/perm-employers/[slug]": {
    hub: "/perm-employers/browse/[letter]",
    owed:
      "A letter page lists the first 1,000 names (BROWSE_MAX) and most employer letters hold more (S 7,585, A 7,282, C 6,300, M 5,246, Nov 20 2026). The 15,678 live-only employers and 204,872 with no PERM record (live-employer-*.xml, other-employer-*.xml) aren't in the A to Z at all; they're linked only from activity tables, case lists and search.",
  },
  "/perm-attorneys/[slug]": {
    hub: "/perm-attorneys/browse/[letter]",
    owed: "A letter page lists the first 1,000 names (BROWSE_MAX); L holds 1,444 firms (Nov 20 2026), so 444 aren't linked from it.",
  },
  "/perm-wages/[slug]": {
    hub: "/perm-wages/browse/[letter]",
    owed: `Every letter is under the 1,000-name cap (C, the biggest, 184 on Nov 20 2026). ${UNTESTED}`,
  },

  "/perm-cities/[slug]": { hub: "/perm-cities", owed: GROUP_OWED },
  "/perm-industries/[slug]": { hub: "/perm-industries", owed: GROUP_OWED },
  "/perm-countries/[slug]": { hub: "/perm-countries", owed: GROUP_OWED },

  "/visa-bulletin/[month]": {
    hub: "/visa-bulletin",
    proof: { test: "src/app/__tests__/bulletin-hub-links-every-month.test.tsx", mark: "BulletinMonthStrip" },
  },
  "/visa-bulletin/categories/[line]": { hub: "/visa-bulletin/categories", owed: UNTESTED },
  "/uscis-receipt-blocks/[block]": {
    hub: "/uscis-receipt-blocks",
    owed: `The index lists every block with sampled cases, every link kept in the HTML (ListPages). ${UNTESTED}`,
  },
  "/consular-posts/[post]": {
    hub: "/consular-posts",
    owed: `The table renders every row (89 of 89 posts linked on the live index, Nov 20 2026). ${UNTESTED}`,
  },
  "/uscis-processing-times/[form]": { hub: "/uscis-processing-times", owed: UNTESTED },
  "/i485-by-field-office/[office]": { hub: "/i485-by-field-office", owed: UNTESTED },
  "/h1b-employers/[state]": { hub: "/h1b-employers", owed: UNTESTED },
  "/law-firm-rankings/[state]": { hub: "/law-firm-rankings", owed: UNTESTED },
  "/perm-queue/[month]": { hub: "/perm-queue", owed: UNTESTED },
  "/perm-rfi-audit/[stage]": { hub: "/perm-rfi-audit", owed: UNTESTED },
};

/** Families the sitemap leaves out on purpose, and why: a page asking not to be indexed needs no hub for search. */
export const UNLISTED_FAMILIES: Readonly<Record<string, string>> = {
  "/perm-queue/[month]/[day]": "noindex: a filing day's list, reached from its month page; robots.txt keeps crawlers off.",
  "/perm-updates/[day]": "noindex: one day's moves, reached from /perm-updates.",
};
