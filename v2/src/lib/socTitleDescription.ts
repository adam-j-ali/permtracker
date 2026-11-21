/**
 * The search description of a job title's page (/soc-codes/<title>), from the figures the page prints: the
 * codes employers filed the title under with each one's share, the filings counted, and BLS's median pay for
 * the main code when the page shows it. Nothing else goes in, so the snippet never says what the page doesn't.
 *
 * Every true combination is offered, and the richest lead that lands between 120 and 155 characters wins: a
 * two-letter title ("RN") gains the second code or the pay, a 60-character one drops the code's name. The old
 * template offered three sentences and 659 pages fell to the shortest, about 83 characters (Ahrefs, Nov 21 2026).
 */

import { DESCRIPTION_MAX, firstThatFits } from "@/lib/describe";
import { formatDollars, formatInt, formatShareOf } from "@/lib/format";

/** Where a description should land when the page has the figures for it; the gate's floor is 110. */
const TARGET_MIN = 120;

export interface SocTitleFacts {
  title: string;
  /** The title's filings under every code. */
  total: number;
  /** The codes it was filed under, busiest first. */
  codes: ReadonlyArray<{ soc: string; codeTitle: string; filings: number }>;
  /** BLS's national median for the main code, only when the page prints it. */
  pay: number | null;
}

export function socTitleDescription({ title, total, codes, pay }: SocTitleFacts): string {
  const [top, second] = codes;
  const n = formatInt(total);
  if (!top) {
    return firstThatFits([
      `${title} has ${n} filings in DOL's PERM, wage request and H-1B files. See the SOC codes O*NET lists for it, and which code the job should use.`,
      `${title}: ${n} filings in DOL's PERM, wage request and H-1B files, and the SOC codes O*NET lists for the title.`,
    ]);
  }
  const share = formatShareOf(top.filings, total);
  const leads = [
    `Employers filed ${title} under ${top.soc} ${top.codeTitle} in ${share} of ${n} DOL filings`,
    `Employers filed ${title} under SOC code ${top.soc} in ${share} of ${n} DOL filings`,
    `${title}: SOC code ${top.soc} in ${share} of ${n} DOL filings`,
  ];
  const others = codes.length - 1;
  const seconds = [
    "",
    ...(second
      ? [
          `, and ${second.soc} ${second.codeTitle} in ${formatShareOf(second.filings, total)}`,
          `, and ${second.soc} in ${formatShareOf(second.filings, total)}`,
        ]
      : []),
    ...(others > 0 ? [`, and ${others === 1 ? "one other code" : `${formatInt(others)} other codes`}`] : []),
  ];
  const tails = [
    ...(others > 0 ? [" See every code employers used, with its share."] : []),
    ...(pay ? [` BLS median pay for ${top.soc}: ${formatDollars(pay)} a year.`] : []),
    " Counted from PERM, wage request and H-1B LCA files.",
  ];
  const byLead = leads.map((lead) => {
    const out = new Set<string>();
    for (const more of seconds) {
      for (let mask = 0; mask < 1 << tails.length; mask++) out.add(`${lead}${more}.${tails.filter((_, i) => mask & (1 << i)).join("")}`);
    }
    // Longest first, so the one that fits says the most the page holds.
    return [...out].sort((a, b) => b.length - a.length);
  });
  // The richest lead that reaches the target wins (the code's name says more than a closing line); else the
  // longest anything that fits, with the shortest lead as the last resort.
  for (const options of byLead) {
    const best = options.find((c) => c.length <= DESCRIPTION_MAX);
    if (best && best.length >= TARGET_MIN) return best;
  }
  return firstThatFits(byLead.flat().sort((a, b) => b.length - a.length));
}
