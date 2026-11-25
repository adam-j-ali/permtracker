import { approvedShareOfDecisions } from "@convex/lib/approval";
import { Fragment } from "react";
import type { ReactNode } from "react";
import Link from "next/link";

import { ChartTips } from "@/components/data/ChartTips";
import { plainText } from "@/components/data/MoreText";
import { Chapter } from "@/components/entities/Chapter";
import { ChapterFold } from "@/components/entities/ChapterFold";
import { yearTrend, type StatCard } from "@/components/entities/EntityPageParts";
import { YearBars, type YearCount } from "@/components/entities/YearBars";
import { GROUP_PATH, type GroupDetail, type GroupKind, type GroupSummary } from "@/lib/db/groups";
import { stateName } from "@/lib/usStateNames";
import { formatInt } from "@/lib/format";
import { entityHref } from "@/lib/entityPayload";
import { keepWhole } from "@/components/ui/keep-whole";

/**
 * One city's, industry's or country's PERM record, in the order a reader needs it: who files here and for what
 * (open, each list in a box), the decisions by year, then the rest of the record behind one line. The headline
 * figures and the answer line sit in the page's header (GroupPages.tsx). Every list is a way into another page, and
 * a link to another group is drawn only when that group is big enough to have a page (the builder's floor), so no
 * link here 404s.
 */

const FLOOR = 20;

/** A ranked list in the house's box: a 2px ink edge and a hard offset, on the card. */
function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-2 border-border bg-card p-5 shadow-hard-sm sm:p-6">
      <h3 className="font-heading text-lg font-bold">{title}</h3>{" "}
      {children}
    </section>
  );
}

/**
 * A name in a ranked list is a link alone on its line, so on a phone it's a 44px tap target: its 20px line plus 12px
 * above and below. The same 12px comes back off as margin, so the box reaches over the gap above the name and the
 * bar under it, and forty rows stay the height they were.
 */
const RANKED_LINK = "link max-sm:-my-3 max-sm:py-3";

/** How many names a ranked list shows before the rest wait behind "The other N". */
const SHOWN = 10;

interface RankedItem {
  key: string;
  label: ReactNode;
  n: number;
}

function RankedRows({
  items,
  from,
  of,
  top,
  label,
}: {
  items: RankedItem[];
  /** The rank of the first row, less one. */
  from: number;
  /** The whole list's length, for the readout. */
  of: number;
  /** The whole list's largest count, so both parts draw to one scale. */
  top: number;
  label: string;
}) {
  return (
    <ChartTips label={label} className="mt-4">
    <ul className="space-y-2.5 max-sm:space-y-3">
      {items.map((it, i) => (
        <Fragment key={it.key}>
          {" "}
          <li data-tip={`${plainText(it.label)}\n${formatInt(it.n)} ${it.n === 1 ? "case" : "cases"}\n#${from + i + 1} of ${of} shown`}>
            <span className="flex items-baseline justify-between gap-3">
              {/* The name is one clipped line, link or plain text: the clip is on the child, so a link's tap box isn't cut. */}
              <span className="min-w-0 text-sm font-bold [&>*]:block [&>*]:truncate">
                {typeof it.label === "string" ? <span>{keepWhole(it.label)}</span> : it.label}
              </span>{" "}
              <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">{formatInt(it.n)}</span>
            </span>{" "}
            <span className="mt-1 block h-2 w-full bg-sage" aria-hidden="true">
              <span
                className="block h-full bg-primary"
                style={{ width: `${top > 0 ? Math.max(2, (it.n / top) * 100) : 0}%` }}
              />
            </span>
          </li>
        </Fragment>
      ))}
    </ul>
    </ChartTips>
  );
}

/**
 * The busiest names, then the rest behind one line. Every name stays in the page (a native details), so search and
 * find-in-page read them all; a list only two longer than the cut shows whole, since a fold for two names costs
 * more than it saves.
 */
function Ranked({
  items,
  label,
}: {
  items: RankedItem[];
  /** What the list ranks, for the keyboard focus announcement. */
  label: string;
}) {
  const top = items[0]?.n ?? 0;
  const cut = items.length > SHOWN + 2 ? SHOWN : items.length;
  const rest = items.slice(cut);
  return (
    <>
      <RankedRows items={items.slice(0, cut)} from={0} of={items.length} top={top} label={label} />{" "}
      {rest.length > 0 ? (
        <details className="group mt-4">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold underline underline-offset-4 decoration-1 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            {`The other ${formatInt(rest.length)}`}
          </summary>{" "}
          <RankedRows items={rest} from={cut} of={items.length} top={top} label={`${label}, after the first ${cut}`} />
        </details>
      ) : null}
    </>
  );
}

/**
 * A title that repeats in one list carries its code. Agencies reuse a title
 * across code vintages (SOC 2010's 15-1121 and SOC 2018's 15-1211 are both
 * "Computer Systems Analysts"; NAICS 2017's 454110 and 2022's 45411 are both
 * "Electronic Shopping and Mail-Order Houses"), so two rows would otherwise
 * read as one name with two counts.
 */
function codedWhereRepeated<T>(
  rows: readonly T[],
  title: (r: T) => string,
  code: (r: T) => string,
  kind: string,
): (r: T) => string {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(title(r), (seen.get(title(r)) ?? 0) + 1);
  return (r) => ((seen.get(title(r)) ?? 0) > 1 ? `${title(r)} (${kind} ${code(r)})` : title(r));
}

export const KIND_NOUN: Record<GroupKind, string> = {
  city: "city",
  industry: "industry",
  country: "country of citizenship",
};

/** "FY2016 to FY2025", or the one year. */
function span(from: number | null, to: number | null): string | null {
  if (from == null || to == null) return null;
  return from === to ? `FY${from}` : `FY${from} to FY${to}`;
}

/**
 * The header's three figures: how many decisions, how they were decided (the certified and denied counts are its
 * note), and what the certified jobs paid. The span of years is the decisions' note, and the decisions carry their
 * year-on-year move, the newest year left out while DOL's file for it is partial.
 */
export function groupFigures(group: GroupSummary, years: readonly YearCount[], partialFy: number | null): StatCard[] {
  const decided = group.certified + group.denied;
  const share = approvedShareOfDecisions(group.certified, group.denied);
  const tally = `${formatInt(group.certified)} certified, ${formatInt(group.denied)} denied`;
  return [
    {
      k: "Decisions",
      v: formatInt(group.total),
      sub: span(group.fyFrom, group.fyTo) ?? "",
      icon: "filings",
      trend: yearTrend(years, partialFy),
    },
    decided >= FLOOR && share !== null
      ? { k: "Approval", v: `${(share * 100).toFixed(1)}%`, sub: tally, icon: "approval" }
      : { k: "Approval", v: "Not shown", sub: `${tally}: too few to rate`, icon: "approval" },
    {
      k: "Median certified wage",
      v: group.medianWage == null ? "n/a" : `$${formatInt(Math.round(group.medianWage))}`,
      sub: group.medianWage == null ? "no wage on the decided cases" : "as filed, every year pooled",
      icon: "wage",
    },
  ];
}

const ANSWER_SUBJECT: Record<GroupKind, (label: string) => string> = {
  city: (l) => `name ${l} as the worksite`,
  industry: () => "carry this industry's code",
  country: (l) => `were for citizens of ${l}`,
};

/** The one line under the name: how many decisions, over which years, and who filed the most. */
export function groupAnswer(kind: GroupKind, group: GroupSummary & { detail: GroupDetail }): string {
  const years = span(group.fyFrom, group.fyTo);
  const when = years ? (group.fyFrom === group.fyTo ? ` in ${years}` : ` from ${years}`) : "";
  const noun = group.total === 1 ? "decision" : "decisions";
  const lead = `${formatInt(group.total)} PERM ${noun}${when} ${ANSWER_SUBJECT[kind](group.label)}.`;
  const top = group.detail.employers[0];
  return top ? `${lead} ${top.name} filed the most.` : lead;
}

export function GroupView({
  kind,
  group,
  yearsOverride,
}: {
  kind: GroupKind;
  group: GroupSummary & { detail: GroupDetail };
  /** A country's FY2008 onward series from perm_country_years. */
  yearsOverride?: YearCount[];
}) {
  const d = group.detail;
  const years = yearsOverride && yearsOverride.length > 0 ? yearsOverride : d.years;
  // Who files here and for what: the two lists most readers came for, open side by side.
  const lead: ReactNode[] = [];
  // Where the work is and who does it: the rest of the record, behind one line.
  const more: ReactNode[] = [];
  const moreNames: string[] = [];

  if (d.employers.length > 0) {
    lead.push(
      <Box key="emp" title="Top sponsors">
        <Ranked label="Top sponsors"
          items={d.employers.map((e) => ({
            key: e.slug ?? `name:${e.name}`,
            n: e.n,
            label: e.slug ? (
              <Link href={entityHref("employer", e.slug)} className={RANKED_LINK}>
                {e.name}
              </Link>
            ) : (
              e.name
            ),
          }))}
        />
      </Box>,
    );
  }
  if (d.occupations.length > 0) {
    const occName = codedWhereRepeated(d.occupations, (o) => o.title, (o) => o.code, "SOC");
    lead.push(
      <Box key="occ" title="Top occupations">
        <Ranked label="Top occupations"
          items={d.occupations.map((o) => ({
            key: o.code,
            n: o.n,
            label: o.slug ? (
              <Link href={entityHref("occupation", o.slug)} className={RANKED_LINK}>
                {occName(o)}
              </Link>
            ) : (
              occName(o)
            ),
          }))}
        />
      </Box>,
    );
  }
  if (kind !== "city" && d.states.length > 0) {
    moreNames.push("states");
    more.push(
      <Box key="st" title="Worksite states">
        <Ranked label="Worksite states" items={d.states.map((s) => ({ key: s.key, n: s.n, label: stateName(s.key) }))} />
      </Box>,
    );
  }
  if (d.cities.length > 0) {
    moreNames.push("cities");
    more.push(
      <Box key="city" title="Worksite cities">
        <Ranked label="Worksite cities"
          items={d.cities.map((c) => ({
            key: c.key,
            n: c.n,
            label:
              c.n >= FLOOR ? (
                <Link href={`${GROUP_PATH.city}/${c.slug}`} className={RANKED_LINK}>
                  {keepWhole(c.label)}
                </Link>
              ) : (
                c.label
              ),
          }))}
        />
      </Box>,
    );
  }
  if (d.industries.length > 0) {
    moreNames.push("industries");
    const named = codedWhereRepeated(d.industries, (i) => i.title, (i) => i.code, "NAICS");
    more.push(
      <Box key="ind" title="Industries">
        <Ranked label="Industries"
          items={d.industries.map((i) => ({
            key: i.code,
            n: i.n,
            label:
              i.n >= FLOOR && i.code.length === 6 ? (
                <Link href={`${GROUP_PATH.industry}/${i.code}`} className={RANKED_LINK}>
                  {named(i)}
                </Link>
              ) : (
                named(i)
              ),
          }))}
        />
      </Box>,
    );
  }
  if (d.countries.length > 0) {
    moreNames.push("countries of citizenship");
    more.push(
      <Box key="cty" title="Countries of citizenship">
        <Ranked label="Countries of citizenship"
          items={d.countries.map((c) => ({
            key: c.key,
            n: c.n,
            label:
              c.n >= FLOOR ? (
                <Link href={`${GROUP_PATH.country}/${c.slug}`} className={RANKED_LINK}>
                  {keepWhole(c.label)}
                </Link>
              ) : (
                c.label
              ),
          }))}
        />
      </Box>,
    );
  }
  if (d.education.length > 0) {
    moreNames.push("education");
    more.push(
      <Box key="edu" title="Worker's education">
        <Ranked label="Worker's education" items={d.education.map((e) => ({ key: e.key, n: e.n, label: e.key }))} />
      </Box>,
    );
  }
  if (d.visa.length > 0) {
    moreNames.push("visas");
    more.push(
      <Box key="visa" title="Visa held when filed">
        <Ranked label="Visa held when filed" items={d.visa.map((v) => ({ key: v.key, n: v.n, label: v.key }))} />
      </Box>,
    );
  }

  const last = moreNames[moreNames.length - 1];
  const moreHint = moreNames.length > 1 ? `The ${moreNames.slice(0, -1).join(", ")} and ${last}` : last ? `The ${last}` : undefined;

  return (
    <>
      {lead.length > 0 ? (
        <Chapter id="who" title="Who files here, and for what" dek="The sponsors and the jobs with the most decisions.">
          <div className="grid grid-cols-1 gap-6 [&>*]:min-w-0 md:grid-cols-2">{lead}</div>
        </Chapter>
      ) : null}

      {years.length > 1 ? (
        <Chapter id="years" title="Year by year">
          <YearBars
            years={years}
            note={
              kind === "country"
                ? "Fiscal years run October to September. DOL printed the worker's citizenship on its old form, so the series runs FY2008 to FY2023. The form in use since mid-2023 doesn't carry it."
                : "Fiscal years run October to September. FY2016 to FY2023 come from DOL's closed-year files, and FY2024 on from its current ones. The newest year is partial until DOL publishes its fourth quarter."
            }
          />
        </Chapter>
      ) : null}

      {more.length > 0 ? (
        <ChapterFold summary="More of the record" hint={moreHint} className="mt-10">
          <div className="grid grid-cols-1 gap-6 [&>*]:min-w-0 md:grid-cols-2">{more}</div>
        </ChapterFold>
      ) : null}
    </>
  );
}
