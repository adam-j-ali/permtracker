/**
 * /uscis-receipt-blocks: "which receipt block is USCIS processing?" (Batch 3). A receipt or block typed in opens that
 * block's page; below, where approvals stop in the sample for each common form, one chart of the approved share by
 * block, every block with cases as a crawlable link, then how to read it and how the sample is drawn. Every figure is
 * the sample's and dated; the receipt numbers behind it never show.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { DataProvenance } from "@/components/data/DataProvenance";
import { FigurePlate } from "@/components/tools/FigurePlate";
import { BlockApprovalChart } from "@/components/uscis/BlockApprovalChart";
import { BlockSearch } from "@/components/uscis/BlockSearch";
import { MonthTable } from "@/components/uscis/MonthTable";
import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";
import { ListPages } from "@/components/ui/list-pages";
import { CaveatBox } from "@/components/ui/note";
import { getSampleBlocks, getSampleMeta, getSampleMonths } from "@/lib/db/uscisSample";
import { formatAsOf } from "@/lib/dolFormat";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";
import { blockForms, chartSeries, monthRows, topForms } from "@/lib/uscisSample";

const TITLE = "USCIS Receipt Blocks: Where Approvals Are Now";
const DESCRIPTION =
  "Type your IOE receipt or block to see how cases near yours are moving: the share approved in each block, from receipt numbers checked on USCIS's page.";
const PATH = "/uscis-receipt-blocks";

export const metadata: Metadata = withSocialCard(
  {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: PATH },
    openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: PATH },
  },
  "uscis-receipt-blocks",
);

// The sample loads nightly; an hour's window keeps the page current within the morning.
export const revalidate = 3600;

const int = (n: number) => n.toLocaleString("en-US");
const pct = (x: number) => `${Math.round(x * 100)}%`;

export default async function UscisReceiptBlocksPage() {
  const [meta, doc, months] = await Promise.all([getSampleMeta(), getSampleBlocks(), getSampleMonths()]);
  const forms = doc ? topForms(doc, 5) : [];
  const series = doc ? chartSeries(doc, forms) : [];
  const held = doc
    ? Object.keys(doc.by_block)
        .sort()
        .map((block) => ({ block, forms: blockForms(doc.by_block[block] ?? {}) }))
        .filter((b) => b.forms.length > 0)
    : [];
  const i485 = series.find((s) => s.form === "I-485");
  const monthSeries = months
    ? chartSeries(doc ?? { as_of: "", groups: [], by_block: {} }, forms).map((s) => s.form)
        .map((form) => ({
          form,
          rows: monthRows(months, form).map((r) => ({
            month: r.month,
            counted: r.counted,
            approvedCount: r.approved.count,
            approved: r.approved.share,
            low: r.approved.low,
            high: r.approved.high,
            rfe: r.rfe.share,
            waiting: r.waiting.share,
            pending: r.pending,
            walked: r.walked,
          })),
        }))
        .filter((s) => s.rows.length > 0)
    : [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <div className="pt-10 sm:pt-12" />
      <header>
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
          USCIS receipt blocks: where approvals are now
        </h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Type your receipt number or its block to see how cases filed near yours are moving. Each figure comes from a
          spread of receipt numbers we check on USCIS&apos;s own Case Status page.
        </p>
      </header>

      <div className="mt-8 border-2 border-border bg-tint p-5 shadow-hard sm:p-6">
        <BlockSearch />
      </div>

      {!doc || !meta ? (
        <p className="mt-8 max-w-2xl border-2 border-border bg-card p-5 text-base leading-relaxed">
          The sample&apos;s first figures load overnight. Until then, check your own case on{" "}
          <Link href="/uscis-case-status" className="link">
            the USCIS case status page
          </Link>
          .
        </p>
      ) : (
        <>
          <section className="mt-10" aria-labelledby="now-title">
            <h2 id="now-title" className="font-heading text-2xl font-bold">
              Where the sample sees approvals, {formatAsOf(meta.as_of)}
            </h2>{" "}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0">
              <div className="border-2 border-border bg-card p-5">
                <p className="text-sm font-bold text-muted-foreground">
                  <KeepWhole>{"I-485 approvals seen up to block"}</KeepWhole>
                </p>{" "}
                <p className="mt-2 font-mono text-4xl font-bold leading-none">{i485?.stopAfter ?? "none yet"}</p>{" "}
                <p className="mt-2 text-base">The newest block where the sample saw an approved green card application.</p>
              </div>{" "}
              <div className="border-2 border-border bg-card p-5">
                <p className="text-sm font-bold text-muted-foreground">Cases in the sample</p>{" "}
                <p className="mt-2 font-heading text-4xl font-bold leading-none tabular-nums">{int(meta.cases)}</p>{" "}
                <p className="mt-2 text-base">Every form, online and paper filings.</p>
              </div>{" "}
              <div className="border-2 border-border bg-card p-5">
                <p className="text-sm font-bold text-muted-foreground">Online blocks with cases</p>{" "}
                <p className="mt-2 font-heading text-4xl font-bold leading-none tabular-nums">{int(held.length)}</p>{" "}
                <p className="mt-2 text-base">Each block is 100,000 online (IOE) receipt numbers.</p>
              </div>
            </div>
          </section>

          <section className="mt-12" aria-label="Approved share by block" data-embed="uscis-receipt-blocks">
            <FigurePlate
              title="Share approved in each receipt block"
              subject={`Sampled cases of one form, ${formatAsOf(meta.as_of)}`}
              caption="Each dot is the share of the block's sampled cases USCIS shows as approved. Its line is the 95% margin: a block with few sampled cases has a long one."
              source="Receipt numbers we check on USCIS's Case Status page, each counted at its newest status."
            >
              <BlockApprovalChart series={series} />
            </FigurePlate>
          </section>

          {monthSeries.length ? (
            <section className="mt-12" aria-labelledby="months-title">
              <h2 id="months-title" className="font-heading text-2xl font-bold">
                By the month a case was filed
              </h2>{" "}
              <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
                The same shares for online filings, by receipt month. A month&apos;s newest cases are the least decided,
                so its share approved climbs as the month ages. Each case counts in the month USCIS received it, as its
                own status page says, because USCIS doesn&apos;t number cases in the order it receives them.
              </p>{" "}
              <div className="mt-4">
                <MonthTable series={monthSeries} />
              </div>
            </section>
          ) : null}

          <section className="mt-12" aria-labelledby="all-title">
            <h2 id="all-title" className="font-heading text-2xl font-bold">
              Every block with cases
            </h2>{" "}
            <ul id="blocks" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
              {held.map(({ block, forms: f }) => {
                const total = f.reduce((n, x) => n + x.counted, 0);
                const top = f.find((x) => x.form === "I-485") ?? f[0]!;
                return (
                  <li key={block}>
                    {" "}
                    <Link
                      href={`/uscis-receipt-blocks/${block}`}
                      className="flex min-h-11 items-baseline justify-between gap-3 border-2 border-border bg-card px-4 py-2 hover:bg-tint"
                    >
                      <span className="font-mono font-bold">{block}</span>{" "}
                      <span className="text-sm text-muted-foreground">
                        {int(total)} cases, {keepWhole(top.form)} {pct(top.approved.share)} approved
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>{" "}
            <ListPages listId="blocks" total={held.length} perPage={60} noun="blocks" />
          </section>
        </>
      )}

      <section className="mt-12 max-w-3xl" aria-labelledby="read-title">
        <h2 id="read-title" className="font-heading text-2xl font-bold">
          How to read a block
        </h2>{" "}
        <CaveatBox className="mt-4">
          <ul className="list-disc space-y-2 pl-5 text-base leading-relaxed">
            <li>
              A block is 100,000 online receipt numbers in a row, named by its first eight characters (IOE09366). Paper
              filings carry other letters and have no blocks.
            </li>{" "}
            <li>
              These are samples. A block with 20 sampled cases of a form can be off by 20 points, which is why every share
              shows its margin and its count.
            </li>{" "}
            <li>
              USCIS doesn&apos;t decide strictly in receipt order. Field offices, interviews and evidence requests move
              cases at different speeds, so a later block can show approvals before an earlier one.
            </li>{" "}
            <li>
              Your own case&apos;s status is on USCIS&apos;s Case Status page. This page shows how cases near yours are
              moving, never your case itself.
            </li>
          </ul>
        </CaveatBox>
      </section>

      <section className="mt-12 max-w-3xl" aria-labelledby="method-title">
        <h2 id="method-title" className="font-heading text-2xl font-bold">
          How the sample works
        </h2>{" "}
        <p className="mt-3 text-base leading-relaxed">
          Each day we check a spread of receipt numbers on USCIS&apos;s public Case Status page and record the status it
          shows. The numbers are drawn at random across each month&apos;s range, with extra draws in the blocks people ask
          about, and each is checked again later to see it move. A number counts once, at its newest status. Shares are
          weighted to the size of each range, and each comes with a 95% margin from the number of cases behind it. The
          receipt numbers themselves are never shown here or shared.
        </p>{" "}
        <DataProvenance datasets={["uscis-sample"]} className="mt-6" />
      </section>
    </div>
  );
}
