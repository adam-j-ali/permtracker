/**
 * The pages that print USCIS's posted processing times (`lib/db/uscisPosted`), expired the run the posted-times
 * loader finishes, so a new USCIS posting shows the day it's copied instead of waiting out a page's weekly window.
 *
 * IN ITS OWN MODULE BECAUSE A `route.ts` MAY NOT EXPORT ANYTHING ELSE (see `revalidate-dol/paths.ts`).
 * `route.test.ts` re-derives the list from the app tree.
 */
export const USCIS_TIMES_PAGES = ["/tools/ead-extension", "/tools/uscis-case-inquiry", "/uscis-processing-times"] as const;

/**
 * Each form's own page prints the posting's figures for its categories. One pattern expires all of them, and an
 * expired page costs one render on its next visit.
 *
 * THE PATTERN IS THE FILE PATH, ROUTE GROUPS INCLUDED (see `revalidate-bulletin/paths.ts`): without the groups the
 * call matches nothing and says nothing, so the test checks it against a real `page.tsx`.
 */
export const USCIS_TIMES_PAGE_FAMILIES = ["/(site)/(public)/uscis-processing-times/[form]"] as const;
