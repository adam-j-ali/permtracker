/**
 * Search descriptions for the city, industry and country pages, and for a city with H-1B filings and no PERM
 * page. Pure, so the window they keep (110 to 160 characters for every real name, templateDescriptions.test.ts)
 * is tested on the names themselves: a Census industry title runs to 126 characters, a city can be "Ada, OK".
 */

import { firstThatFits } from "@/lib/describe";
import { formatInt, formatShareOf } from "@/lib/format";
import { industryName } from "@/lib/industryTitle";
import type { GroupKind } from "@/lib/db/groups";

export interface GroupFacts {
  kind: GroupKind;
  /** The group's name as the page prints it: a city with its state, a Census title, a country. */
  label: string;
  /** The NAICS code, the city key or the country key. */
  key: string;
  /** PERM decisions counted. */
  total: number;
  fyFrom: number | null;
  fyTo: number | null;
}

/** What the description is about: the page's own name leads, so two places with one count never share a sentence. */
function subjectOf({ kind, label, key }: GroupFacts): string {
  if (kind === "industry") return `PERM in ${industryName(label)} (NAICS ${key})`;
  if (kind === "city") return `PERM jobs in ${label}`;
  return `PERM cases for citizens of ${label}`;
}

export function groupDescription(g: GroupFacts): string {
  const subject = subjectOf(g);
  const fy = g.fyFrom && g.fyTo ? `, FY${g.fyFrom} to FY${g.fyTo}` : "";
  const decisions = `${formatInt(g.total)} PERM decision${g.total === 1 ? "" : "s"}${fy}`;
  const holds = "with the approval rate, wages, top sponsors and jobs";
  return firstThatFits([
    `${subject}: ${decisions}, ${holds}, from DOL's own files.`,
    `${subject}: ${decisions}, ${holds}.`,
    // A Census title can run to 126 characters, so nothing above fits; the code leads and the name gives way.
    ...(g.kind === "industry" ? [`PERM under NAICS ${g.key}: ${decisions}, ${holds}, from DOL's own files.`] : []),
    `${subject}: ${decisions}.`,
  ]);
}

export interface H1bCityFacts {
  /** "Ada, OK". */
  label: string;
  /** LCAs naming a worksite there. */
  total: number;
  certified: number;
  fyFrom: number | null;
  fyTo: number | null;
  /** The page's top lists (certified LCAs in the newest three fiscal years); absent counts as listed. */
  employers?: readonly unknown[];
  occupations?: readonly unknown[];
}

export function h1bCityDescription(c: H1bCityFacts): string {
  const span = c.fyFrom && c.fyTo ? `, FY${c.fyFrom} to FY${c.fyTo}` : "";
  const lcas = `${formatInt(c.total)} H-1B LCAs${span}`;
  const certified = c.total > 0 ? `, ${formatShareOf(c.certified, c.total)} certified` : "";
  // A city whose LCAs are all older than the newest three fiscal years (DOL's FY2008 to FY2019 files among them)
  // lists no employers or jobs, so its description doesn't promise them.
  const listed = (c.employers?.length ?? 1) > 0 || (c.occupations?.length ?? 1) > 0;
  if (!listed) {
    return firstThatFits([
      `H-1B jobs in ${c.label}: ${lcas}${certified}, counted from DOL's own H-1B labor condition application files.`,
      `H-1B jobs in ${c.label}: ${lcas}${certified}, from DOL's own LCA files.`,
      `H-1B jobs in ${c.label}: ${lcas}.`,
    ]);
  }
  return firstThatFits([
    `H-1B jobs in ${c.label}: ${lcas}${certified}, with the employers and jobs behind them, from DOL's own LCA files.`,
    `H-1B jobs in ${c.label}: ${lcas}${certified}, with the employers and jobs behind them.`,
    `H-1B jobs in ${c.label}: ${lcas}.`,
  ]);
}
