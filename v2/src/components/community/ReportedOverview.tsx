import Link from "next/link";

import { BarRows, type BarRow } from "@/components/data/BarRows";
import { Figure, FigureRow } from "@/components/data/FigureRow";
import type { ReportedOverview as Overview } from "@/lib/db/communityReports";
import { formatInt } from "@/lib/format";
import { shortSourceName } from "@/lib/reportedCases";
import { officeByCode, officeHref } from "@/lib/uscisOffices";
import { KeepWhole } from "@/components/ui/keep-whole";

/**
 * Every case people reported, from every source, at a glance (the merged list, src/lib/reportedCases.ts): how many
 * people, how many were in more than one place, where they were reported, and where each slice lives on the site.
 * The timelines shared here stay the page's own checked board below it.
 */
export function ReportedOverview({
  overview,
  counted = null,
}: {
  overview: Overview | null;
  /**
   * Every case the step figures count (the summary's headline): the listed ones here plus the timelines and saved cases
   * their owners shared privately. Two counts that both said "each person once" read as a mistake (Nov 25 2026), so the
   * gap is named.
   */
  counted?: number | null;
}) {
  if (!overview || overview.people === 0) return null;
  const unlisted = counted !== null && counted > overview.people ? counted - overview.people : 0;
  const offices = overview.offices.flatMap((o) => {
    const office = officeByCode(o.office);
    const href = officeHref(o.office);
    return office && href ? [{ ...o, name: office.name, href: `${href}#reported-cases` }] : [];
  });
  const sources: BarRow[] = overview.bySource.map((s) => ({
    key: s.source,
    label: shortSourceName(s.source),
    value: s.cases,
    text: formatInt(s.cases),
    tone: s.source === "timeline" ? "primary" : "ink",
  }));

  return (
    <section className="mt-10" aria-labelledby="everyone-h">
      <h2 id="everyone-h" className="font-heading text-2xl font-bold sm:text-3xl">
        Every case people reported, from every source
      </h2>{" "}
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
        People report their own dates in many places. These are all of them we read, each person counted once: two
        reports join only when three of their dates match. Only the timelines shared here are checked.
        {unlisted > 0
          ? ` The step figures above also count ${formatInt(unlisted)} more, timelines and saved cases their owners shared privately, which are never listed.`
          : ""}
      </p>{" "}
      <FigureRow className="mt-5">
        <Figure kind="community" label="People's cases" value={formatInt(overview.people)} note="listed, every source, each person once" />
        <Figure kind="community"
          label="I-485s at a USCIS office"
          value={formatInt(offices.reduce((n, o) => n + o.cases, 0))}
          note={offices.length === 1 ? `all at ${offices[0]!.name}` : `at ${formatInt(offices.length)} offices`}
        />
        <Figure kind="community" label="I-140s" value={formatInt(overview.i140s)} note="by category and premium processing" />
        <Figure kind="community" label="Reported in two places or more" value={formatInt(overview.inSeveral)} note="counted once" />
      </FigureRow>{" "}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 [&>*]:min-w-0">
        <div className="object p-4 sm:p-5">
          <h3 className="font-heading text-lg font-bold">Where they were reported</h3>{" "}
          <p className="mt-1 text-sm text-soft">A case in two places counts in each.</p>{" "}
          <div className="mt-3">
            <BarRows rows={sources} label="Reported cases by where they were reported" />
          </div>
        </div>{" "}
        <div>
          <h3 className="font-heading text-lg font-bold">Where to see them</h3>{" "}
          <ul className="mt-2 space-y-1 text-base">
            {offices.map((o) => (
              <li key={o.office}>
                <Link href={o.href} className="link inline-flex min-h-11 items-center">
                  {o.cases === 1 ? `${o.name}: 1 case` : `${o.name}: ${formatInt(o.cases)} cases, by the day each moved there`}
                </Link>{" "}
              </li>
            ))}
            <li>
              <Link href="/uscis-processing-times/i-140#reported" className="link inline-flex min-h-11 items-center">
                <KeepWhole>{`I-140s: ${formatInt(overview.i140s)} ${overview.i140s === 1 ? "case" : "cases"}, by category and premium processing`}</KeepWhole>
              </Link>{" "}
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
