/**
 * /uscis-receipt-blocks/IOE09366/numbers: every receipt number the sample checked in one block, in number order, each
 * with the last status the sample saw and its days, a short page at a time (?page=, ?per=). Kept out of search engines,
 * as the Privacy Policy's "Our sample of USCIS cases" says; the block's own page carries its figures and stays found.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataProvenance } from "@/components/data/DataProvenance";
import { ServerPager } from "@/components/ui/server-pager";
import { SampleCaseTable } from "@/components/uscis/SampleCaseTable";
import { getBlockCases, getSampleMeta } from "@/lib/db/uscisSample";
import { formatAsOf } from "@/lib/dolFormat";
import { openGraphBase } from "@/lib/openGraphBase";
import { clampPage } from "@/lib/pageItems";
import { withSocialCard } from "@/lib/socialCard";
import { BLOCK_NUMBERS_PER, groupCounts, SAMPLE_GROUP_WORD } from "@/lib/uscisSample";

const BLOCK = /^IOE\d{5}$/;

export async function generateStaticParams(): Promise<{ block: string }[]> {
  return [];
}

type Params = { block: string };
type Search = { page?: string; per?: string; at?: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { block } = await params;
  const title = `Receipt Numbers Checked in USCIS Block ${block}`;
  const description = `Each receipt number our sample checked in USCIS receipt block ${block}, with the last status we saw and the day.`;
  const path = `/uscis-receipt-blocks/${block}/numbers`;
  return withSocialCard(
    {
      title,
      description,
      alternates: { canonical: path },
      openGraph: { ...openGraphBase, title: `${title} | PERM Tracker`, description, url: path },
      robots: { index: false, follow: true },
    },
    "uscis-receipt-blocks",
  );
}

export default async function BlockNumbersPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { block } = await params;
  if (!BLOCK.test(block)) notFound();
  const q = await searchParams;
  const per = BLOCK_NUMBERS_PER.find((n) => String(n) === q.per) ?? BLOCK_NUMBERS_PER[0];
  const asked = Number(q.page ?? "1");
  const [meta, first] = await Promise.all([getSampleMeta(), getBlockCases(block, 1, per)]);
  const pageCount = Math.max(1, Math.ceil(first.total / per));
  const page = clampPage(asked, pageCount);
  const { total, rows } = page === 1 ? first : await getBlockCases(block, page, per);
  const href = (p: number, n: number) =>
    `/uscis-receipt-blocks/${block}/numbers${p > 1 || n !== BLOCK_NUMBERS_PER[0] ? `?${new URLSearchParams({ ...(p > 1 ? { page: String(p) } : {}), ...(n !== BLOCK_NUMBERS_PER[0] ? { per: String(n) } : {}) })}` : ""}`;
  const mark = q.at && /^IOE\d{10}$/.test(q.at) && q.at.startsWith(block) ? q.at : undefined;
  const counts = groupCounts(rows);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <div className="pt-10 sm:pt-12" />
      <p className="text-base">
        <Link href="/uscis-receipt-blocks" className="link">
          USCIS receipt blocks
        </Link>{" "}
        <span aria-hidden="true">/</span>{" "}
        <Link href={`/uscis-receipt-blocks/${block}`} className="link">
          Block <span className="font-mono">{block}</span>
        </Link>
      </p>{" "}
      <header className="mt-3">
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
          Receipt numbers checked in block <span className="font-mono">{block}</span>
        </h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Each number our sample checked on USCIS&apos;s public Case Status page, with the last status we saw
          {meta ? ` (the sample as of ${formatAsOf(meta.as_of)})` : ""}. USCIS may have moved a case since, and its own
          page has today&apos;s status.
        </p>
      </header>{" "}
      {total === 0 ? (
        <div className="mt-8 max-w-2xl border-2 border-border bg-card p-5 text-base leading-relaxed">
          <p>
            {meta
              ? "The sample hasn't checked a number in this block yet."
              : "The sample's first numbers load overnight."}{" "}
            <Link href={`/uscis-receipt-blocks/${block}`} className="link">
              See block {block}
            </Link>
            .
          </p>
        </div>
      ) : (
        <section className="mt-8" aria-labelledby="numbers-title">
          <h2 id="numbers-title" className="font-heading text-2xl font-bold">
            {total.toLocaleString("en-US")} numbers checked
          </h2>{" "}
          <p className="mt-2 text-base">
            On this page:{" "}
            {counts.map((c, i) => (
              <span key={c.grp}>
                {i ? ", " : ""}
                {c.n.toLocaleString("en-US")} {(SAMPLE_GROUP_WORD[c.grp] ?? c.grp).toLowerCase()}
              </span>
            ))}
            .
          </p>{" "}
          <SampleCaseTable rows={rows} label={`Receipt numbers checked in block ${block}, page ${page}`} mark={mark} />{" "}
          <ServerPager
            page={page}
            pageCount={pageCount}
            total={total}
            per={per}
            perOptions={BLOCK_NUMBERS_PER}
            href={href}
            noun="numbers"
            label={`Pages of the numbers in block ${block}`}
          />
        </section>
      )}{" "}
      <DataProvenance datasets={["uscis-sample"]} className="mt-10" />
    </div>
  );
}
