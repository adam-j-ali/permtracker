import Link from "next/link";
import { Fragment } from "react";

import { BarRows, type BarRow } from "@/components/data/BarRows";
import { BrowseList } from "@/components/entities/EntityBrowse";
import { ListPages } from "@/components/ui/list-pages";
import { getSocCodes, titlePagesForCode, titlesForCode } from "@/lib/db/socTitles";
import { formatInt, formatShare } from "@/lib/format";
import { socGroup } from "@/lib/socCode";
import { predecessorsOf } from "@/lib/socCrosswalk";
import { SOC_TITLES_BASE } from "@/lib/socTitleBrowse";
import { titleSlug } from "@/lib/socTitleKey";
import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";

/**
 * On an occupation page: the job titles employers filed under its code in DOL's files, the titles
 * O*NET gives it, and the 2010 codes it replaced, so a reader can tell whether this is their job's
 * code. Under the busiest twelve, every other title with a page whose main code is this one, so each
 * title page is linked from its occupation (15-1252 is the main code of 776, Nov 2026). Renders
 * nothing for a code the finder's table doesn't hold.
 */
export async function CodeTitles({ code, className }: { code: string | null | undefined; className?: string }) {
  const soc = socGroup(code);
  if (!soc) return null;
  // A failed read throws, so an occupation page keeps its last good render rather than caching one without this.
  const [titles, codes, pages] = await Promise.all([titlesForCode(soc, 12), getSocCodes(), titlePagesForCode(soc)]);
  const preds = predecessorsOf(soc);
  const pageMin = codes?.pageMin ?? Infinity;
  const inBars = new Set((titles?.filed ?? []).filter((t) => t.keyFilings >= pageMin).map((t) => titleSlug(t.key)));
  const more = pages.filter((p) => !inBars.has(p.slug));
  if (!titles || (!titles.filed.length && !titles.onet.length && !preds.length && !more.length)) return null;
  const rows: BarRow[] = titles.filed.map((t) => ({
    key: t.key,
    label:
      t.keyFilings >= pageMin ? (
        <Link href={`/soc-codes/${titleSlug(t.key)}`} className="link">
          {keepWhole(t.title)}
        </Link>
      ) : (
        t.title
      ),
    sub: `${formatShare(t.share)} of this title's filings use ${soc}`,
    value: t.filings,
    text: formatInt(t.filings),
    tone: "primary",
  }));
  return (
    <section id="titles" className={className}>
      <h3 className="font-heading text-xl font-bold">The titles employers file under {soc}</h3>{" "}
      <p className="mt-1 max-w-3xl text-base text-soft">
        <KeepWhole>
          {"From DOL's PERM, wage request and H-1B files. The share says how much of each title goes to this code."}
        </KeepWhole>
      </p>{" "}
      {rows.length ? <BarRows rows={rows} inline label={`Job titles filed under ${soc}`} className="mt-4" /> : null}{" "}
      {more.length ? (
        <div className="mt-6">
          <h4 className="font-heading text-lg font-bold">
            {inBars.size ? "More" : "The"} job titles filed most often under {soc}
          </h4>{" "}
          <p className="mt-1 max-w-3xl text-base text-soft">
            Each has a page with every code employers used for it. The number is the title&apos;s filings under every code.
          </p>{" "}
          <BrowseList
            id="code-title-pages"
            base={SOC_TITLES_BASE}
            entries={more.map((p, i) => ({ slug: p.slug, name: p.title, total: p.filings, rank: i + 1 }))}
            unit="filings"
            className="mt-4 scroll-mt-28"
          />{" "}
          <ListPages listId="code-title-pages" total={more.length} perPage={50} noun="job titles" />
        </div>
      ) : null}{" "}
      {titles.onet.length ? (
        <p className="mt-5 max-w-3xl text-base">
          <span className="font-semibold">O*NET also calls it</span>{" "}
          {titles.onet.map((t, i) => (
            <Fragment key={t}>
              {t}
              {i < titles.onet.length - 1 ? ", " : "."}{" "}
            </Fragment>
          ))}
        </p>
      ) : null}{" "}
      {preds.length ? (
        <p className="mt-4 max-w-3xl text-base">
          <span className="font-semibold">Before 2018</span> this job was filed under{" "}
          {preds.map((p, i) => (
            <Fragment key={p.code}>
              <Link href={`/soc-codes?q=${p.code}`} className="link">
                {p.code} {keepWhole(p.title)}
              </Link>
              {i < preds.length - 2 ? ", " : i === preds.length - 2 ? " and " : "."}{" "}
            </Fragment>
          ))}
        </p>
      ) : null}{" "}
      <p className="mt-4 text-base">
        <Link href="/soc-codes" className="link inline-flex min-h-11 items-center">
          Not sure it&apos;s your job&apos;s code? Look a title up
        </Link>
      </p>
    </section>
  );
}
