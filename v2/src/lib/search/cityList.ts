import { lazyList } from "./lazyList";

/** One city's PERM page, as the search palette lists it: its name ("Tampa, FL"), its page, and its state spelled out. */
export interface CityRef {
  label: string;
  href: string;
  keywords: string;
}

/** Every city with a PERM page, from /cities.json, fetched at most once per visit (lazyList). */
const cities = lazyList<CityRef>("/cities.json");

export const loadCities = cities.load;
export const useCities = cities.useList;
/** For tests: forget the fetched list. */
export const resetCityList = cities.reset;
