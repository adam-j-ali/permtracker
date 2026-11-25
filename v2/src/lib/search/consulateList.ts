import { lazyList } from "./lazyList";

/** One consulate's page, as the search palette lists it: its heading, its address and the words people type. */
export interface ConsulateRef {
  label: string;
  href: string;
  keywords: string;
}

/** Every consulate with a page, from /consulates.json, fetched at most once per visit (lazyList). */
const consulates = lazyList<ConsulateRef>("/consulates.json");

export const loadConsulates = consulates.load;
export const useConsulates = consulates.useList;
/** For tests: forget the fetched list. */
export const resetConsulateList = consulates.reset;
