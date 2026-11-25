import { lazyList } from "./lazyList";

/** One job title with a page of its own, as the search palette lists it: the title, the SOC code filed most for it, its page. */
export interface SocTitleRef {
  title: string;
  /** The code employers filed the title under most ("15-1252"); null when none was filed. */
  code: string | null;
  href: string;
}

/** Every job title page, from /soc-titles.json, fetched at most once per visit (lazyList). */
const titles = lazyList<SocTitleRef>("/soc-titles.json");

export const loadSocTitles = titles.load;
export const useSocTitles = titles.useList;
/** For tests: forget the fetched list. */
export const resetSocTitleList = titles.reset;

/** How the palette names a title: "Software Engineer (15-1252)", or the title alone when no code was filed. */
export function socTitleLabel(t: SocTitleRef): string {
  return t.code ? `${t.title} (${t.code})` : t.title;
}
