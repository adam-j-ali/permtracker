/**
 * /uscis-receipt-blocks/IOE09366: one block's answer first (its forms, the share approved with its margin, the newest
 * moves the sample saw, the blocks either side), then where it sits on the chart. A block name that isn't one is a 404;
 * a real block the sample hasn't reached says so, points to its neighbours and stays out of search.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataProvenance } from "@/components/data/DataProvenance";
import { FigurePlate } from "@/components/tools/FigurePlate";
import { BlockApprovalChart } from "@/components/uscis/BlockApprovalChart";
import { BlockSearch } from "@/components/uscis/BlockSearch";
import { keepWhole } from "@/components/ui/keep-whole";
import { CaveatBox } from "@/components/ui/note";
import { ScrollBox } from "@/components/ui/scroll-box";
import { getBlockMoves, getSampleBlocks, getSampleMeta } from "@/lib/db/uscisSample";
import { formatAsOf } from "@/lib/dolFormat";
import { openGraphBase } from "@/lib/openGraphBase";
import { softFail } from "@/lib/softRead";
import { withSocialCard } from "@/lib/socialCard";
import { blockForms, chartSeries, neighbours, topForms } from "@/lib/uscisSample";

export const revalidate = 3600;

const BLOCK = /^IOE\d{5}$/;
const int = (n: number) => n.toLocaleString("en-US");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const MOVED: Record<string, string> = {
  approved: "approved",
  denied: "denied",
  withdrawn: "withdrawn",
  closed: "closed",
  revoked: "revoked",
  rfe: "sent an evidence request",
  waiting: "moved to a waiting step",
  rejected: "rejected as filed",
  decided: "decided",
  other: "changed status",
};

export async function generateStaticParams(): Promise<{ block: string }[]> {
  const doc = await getSampleBlocks().catch(softFail("uscis-receipt-blocks params", null));
  if (!doc) return [];
  return Object.keys(doc.by_block)
    .filter((b) => BLOCK.test(b) && blockForms(doc.by_block[b] ?? {}).length > 0)
    .map((block) => ({ block }));
}

export async function generateMetadata({ params }: { params: Promise<{ block: string }> }): Promise<Metadata> {
  const { block } = await params;
  const doc = BLOCK.test(block) ? await getSampleBlocks() : null;
  const held = doc ? blockForms(doc.by_block[block] ?? {}).length > 0 : false;
  const title = `USCIS Receipt Block ${block}: Approvals by Form`;
  const description = `How the sampled cases in USCIS receipt block ${block} are moving: the share approved for each form, with its margin, and the newest moves.`;
  const path = `/uscis-receipt-blocks/${block}`;
  return withSocialCard(
    {
      title,
      description,
      alternates: { canonical: path },
      openGraph: { ...openGraphBase, title: `${title} | PERM Tracker`, description, url: path },
      ...(held ? {} : { robots: { index: false, follow: true } }),
    },
    "uscis-receipt-blocks",
  );
}

export default async function UscisReceiptBlockPage({ params }: { params: Promise<{ block: string }> }) {
  const { block } = await params;
  if (!BLOCK.test(block)) notFound();
  const [meta, doc, moves] = await Promise.all([
    getSampleMeta(),
    getSampleBlocks(),
    getBlockMoves(block).catch(softFail("getBlockMoves", [])),
  ]);
  const forms = doc ? blockForms(doc.by_block[block] ?? {}) : [];
  const near = doc ? neighbours(doc, block) : { before: null, after: null };
  const lead = forms.find((f) => f.form === "I-485") ?? forms[0];
  const total = forms.reduce((n, f) => n + f.counted, 0);
  const series = doc && forms.length ? chartSeries(doc, topForms(doc, 5)) : [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <div className="pt-10 sm:pt-12" />
      <p className="text-base">
        <Link href="/uscis-receipt-blocks" className="link">
          USCIS receipt blocks
        </Link>
      </p>{" "}
      <header className="mt-3">
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
          USCIS receipt block <span className="font-mono">{block}</span>
        </h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          How the sampled cases among the 100,000 online receipt numbers that start {block} are moving
          {meta ? `, ${formatAsOf(meta.as_of)}` : ""}.
        </p>
      </header>

      {!lead ? (
        <div className="mt-8 max-w-2xl border-2 border-border bg-card p-5 text-base leading-relaxed">
          <p>
            {doc
              ? "The sample has no cases in this block yet. The nearest blocks with cases:"
              : "The sample's first figures load overnight."}
          </p>{" "}
          <NeighbourLinks near={near} />
        </div>
      ) : (
        <>
          <section className="mt-8" aria-labelledby="answer-title">
            <h2 id="answer-title" className="sr-only">
              The block at a glance
            </h2>{" "}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="border-2 border-border bg-card p-5">
                <p className="text-sm font-bold text-muted-foreground">{keepWhole(lead.form)} cases approved</p>{" "}
                <p className="mt-2 font-heading text-5xl font-bold leading-none tabular-nums">{pct(lead.approved.share)}</p>{" "}
                <p className="mt-2 text-base">
                  {int(lead.approved.count)} of {int(lead.counted)} sampled, likely between {pct(lead.approved.low)} and{" "}
                  {pct(lead.approved.high)} of the block&apos;s {keepWhole(lead.form)} cases.
                </p>
              </div>{" "}
              <div className="border-2 border-border bg-card p-5">
                <p className="text-sm font-bold text-muted-foreground">Cases sampled in this block</p>{" "}
                <p className="mt-2 font-heading text-5xl font-bold leading-none tabular-nums">{int(total)}</p>{" "}
                <p className="mt-2 text-base">
                  Across {forms.length} {forms.length === 1 ? "form" : "forms"}, each counted at its newest status.
                </p>
              </div>
            </div>
          </section>

          <section className="mt-10" aria-labelledby="forms-title">
            <h2 id="forms-title" className="font-heading text-2xl font-bold">
              Each form in {block}
            </h2>{" "}
            <ScrollBox className="mt-4" label={`Each form in ${block}`}>
              <table className="w-full min-w-[560px] border-2 border-border text-left text-base">
                <thead className="bg-tint">
                  <tr>
                    <th scope="col" className="px-4 py-2">Form{" "}</th>
                    <th scope="col" className="px-4 py-2 text-right">Sampled{" "}</th>
                    <th scope="col" className="px-4 py-2 text-right">Approved{" "}</th>
                    <th scope="col" className="px-4 py-2">Margin{" "}</th>
                    <th scope="col" className="px-4 py-2 text-right">Evidence request{" "}</th>
                    <th scope="col" className="px-4 py-2 text-right">Still waiting{" "}</th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map((f) => (
                    <tr key={f.form} className="border-t-2 border-border">
                      <th scope="row" className="px-4 py-2 font-mono font-bold">{keepWhole(f.form)}{" "}</th>
                      <td className="px-4 py-2 text-right tabular-nums">{int(f.counted)}{" "}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{pct(f.approved.share)}{" "}</td>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground">
                        {pct(f.approved.low)} to {pct(f.approved.high)}
                      {" "}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{pct(f.figure.groups.rfe.share)}{" "}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{pct(f.figure.groups.waiting.share)}{" "}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollBox>
          </section>

          <section className="mt-10" aria-labelledby="moves-title">
            <h2 id="moves-title" className="font-heading text-2xl font-bold">
              The newest moves the sample saw
            </h2>{" "}
            {moves.length ? (
              <ul className="mt-4 max-w-2xl space-y-2 text-base">
                {moves.map((m) => (
                  <li key={`${m.on_day}-${m.form}-${m.to_grp}`} className="border-l-4 border-border pl-3">
                    <span className="font-bold">{formatAsOf(m.on_day)}:</span>{" "}
                    {int(m.n)} {keepWhole(m.form ?? "case")}
                    {m.n === 1 ? "" : "s"} {MOVED[m.to_grp] ?? "changed status"}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 max-w-2xl text-base text-muted-foreground">
                No status changes seen here yet. The sample checks each number again later, so moves appear as it does.
              </p>
            )}
          </section>

          <section className="mt-10" aria-label="Where this block sits">
            <FigurePlate
              title={`Where ${block} sits among the blocks`}
              subject={meta ? `Share approved in each block, ${formatAsOf(meta.as_of)}` : "Share approved in each block"}
              caption="The ringed dot is this block. Each line is that block's 95% margin."
              source="Receipt numbers we check on USCIS's Case Status page, each counted at its newest status."
            >
              <BlockApprovalChart series={series} highlight={block} />
            </FigurePlate>
          </section>

          <section className="mt-10" aria-labelledby="near-title">
            <h2 id="near-title" className="font-heading text-2xl font-bold">
              The blocks either side
            </h2>{" "}
            <NeighbourLinks near={near} />
          </section>
        </>
      )}

      <section className="mt-10 max-w-3xl" aria-labelledby="another-title">
        <h2 id="another-title" className="font-heading text-2xl font-bold">
          Another block
        </h2>{" "}
        <div className="mt-4 border-2 border-border bg-tint p-5 sm:p-6">
          <BlockSearch />
        </div>{" "}
        <CaveatBox className="mt-6">
          <p className="text-base leading-relaxed">
            These are samples, so a share from few cases can be well off: its margin says how far. USCIS doesn&apos;t
            decide strictly in receipt order. For your own case, use{" "}
            <Link href="/uscis-case-status" className="link">
              the USCIS case status page
            </Link>
            .
          </p>
        </CaveatBox>{" "}
        <DataProvenance datasets={["uscis-sample"]} className="mt-6" />
      </section>
    </div>
  );
}

function NeighbourLinks({ near }: { near: { before: string | null; after: string | null } }) {
  const items = [near.before, near.after].filter((b): b is string => b !== null);
  if (!items.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-3">
      {items.map((b) => (
        <li key={b}>
          {" "}
          <Link
            href={`/uscis-receipt-blocks/${b}`}
            className="inline-flex min-h-11 items-center border-2 border-border bg-card px-4 font-mono font-bold hover:bg-tint"
          >
            {b}
          </Link>
        </li>
      ))}
    </ul>
  );
}
