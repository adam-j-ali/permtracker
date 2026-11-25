"use client";

/**
 * The case page's green card tab: the path past the I-140 and every date and receipt on it, then the visa bulletin
 * line the category and chargeability put the case in, with the priority date read against the newest bulletin.
 *
 * The line's reading uses the central calculator (estimatePriorityDate) on the archive the public bulletin pages
 * read (/api/bulletin-line), so the case page and the public line page can't disagree. Nothing here is an estimate
 * of a USCIS decision; the bulletin says only when a priority date is current.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AirplaneTiltIcon, IdentificationCardIcon, CalendarCheckIcon } from "@phosphor-icons/react";

import { buildEditSectionUrl } from "@/lib/cases/editDeepLinks";
import { receiptPageHref } from "@/lib/cases/publicLinks";
import { bulletinsOf, type BulletinLine } from "@/lib/bulletinLineHistory";
import { lineName } from "@/lib/bulletinLines";
import { countryName } from "@/lib/countries";
import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";
import {
  EB_CATEGORY_LABELS,
  GREEN_CARD_FIELD_LABELS,
  GREEN_CARD_PATH_LABELS,
  bulletinCategoryOf,
  bulletinCountryOf,
  casePriorityDate,
  chargeabilityOf,
  estimatePriorityDate,
  greenCardPathOf,
  type ChartKind,
  type GreenCardDateField,
  type GreenCardReceiptField,
  type PriorityDateEstimate,
} from "@/lib/perm";
import type { CaseDetailData } from "./case-detail-types";
import { fmtISODate } from "./case-detail-utils";
import { PublicNumber } from "./PublicNumber";

interface GreenCardTabProps {
  caseData: CaseDetailData;
}

type Row = { field: GreenCardDateField } | { receipt: GreenCardReceiptField };

const ADJUSTMENT_ROWS: readonly Row[] = [
  { field: "i485FilingDate" },
  { field: "i485ReceiptDate" },
  { receipt: "i485ReceiptNumber" },
  { field: "i485BiometricsDate" },
  { field: "i485InterviewDate" },
  { field: "i485ApprovalDate" },
];

const PERMIT_ROWS: readonly Row[] = [
  { field: "eadFilingDate" },
  { receipt: "eadReceiptNumber" },
  { field: "eadApprovalDate" },
  { field: "apFilingDate" },
  { receipt: "apReceiptNumber" },
  { field: "apApprovalDate" },
];

const CONSULAR_ROWS: readonly Row[] = [{ field: "nvcReceivedDate" }, { field: "ds260SubmittedDate" }, { field: "consularInterviewDate" }];

const CARD_ROWS: readonly Row[] = [{ field: "cardProducedDate" }, { field: "cardReceivedDate" }];

/** "Work permit approved", not "Work permit (I-765) approved": the subhead already names the form. */
const SHORT_LABELS: Partial<Record<GreenCardDateField, string>> = {
  eadApprovalDate: "Work permit approved",
  apApprovalDate: "Travel document approved",
};

function Cells({ rows, caseData }: { rows: readonly Row[]; caseData: CaseDetailData }) {
  return (
    <div className="field-grid" style={{ padding: 0, borderTop: "1px solid var(--border)" }}>
      {rows.map((row) => {
        if ("receipt" in row) {
          const value = caseData[row.receipt];
          return (
            <div key={row.receipt} className="field-cell">
              <div className="fc-label">{GREEN_CARD_FIELD_LABELS[row.receipt]}</div>
              <div className={`fc-val fc-val-text mono ${!value ? "dim" : ""}`} title={value || undefined}>
                <PublicNumber value={value} href={receiptPageHref(value)} />
              </div>
            </div>
          );
        }
        const value = caseData[row.field];
        return (
          <div key={row.field} className="field-cell">
            <div className="fc-label">{keepWhole(SHORT_LABELS[row.field] ?? GREEN_CARD_FIELD_LABELS[row.field])}</div>
            <div className={`fc-val num ${!value ? "dim" : ""}`}>{fmtISODate(value)}</div>
          </div>
        );
      })}
    </div>
  );
}

const CHART_NAME: Record<ChartKind, string> = { finalAction: "Final Action", datesForFiling: "Dates for Filing" };

/** One chart's reading in a sentence: current, shut, or how far the cutoff is behind the priority date. */
function chartSentence(chart: ChartKind, e: PriorityDateEstimate): string {
  const name = CHART_NAME[chart];
  if (!e.latest) return `The ${name} chart prints nothing for this line.`;
  if (e.latest.kind === "unavailable") return `No visa numbers on the ${name} chart this month.`;
  if (e.isCurrent) return `Current on the ${name} chart.`;
  if (e.latest.kind === "date" && e.daysFromCutoff !== null) {
    const months = Math.max(1, Math.round(Math.abs(e.daysFromCutoff) / 30.44));
    return `Not current yet on the ${name} chart: its cutoff is ${fmtISODate(e.latest.iso)}, about ${months.toLocaleString("en-US")} ${months === 1 ? "month" : "months"} before the priority date.`;
  }
  return `Not current yet on the ${name} chart.`;
}

/** The line the case is in, the priority date against the newest bulletin, and the alert for it. */
function BulletinLineCard({ caseData }: { caseData: CaseDetailData }) {
  const category = bulletinCategoryOf(caseData);
  const column = bulletinCountryOf(chargeabilityOf(caseData));
  const priority = casePriorityDate(caseData);
  const [line, setLine] = useState<BulletinLine | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!category || !column) return;
    let live = true;
    setFailed(false);
    fetch(`/api/bulletin-line?set=employment&category=${category}&country=${column}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`bulletin line ${r.status}`);
        const body = (await r.json()) as { ok: boolean; line?: BulletinLine };
        if (live) setLine(body.line ?? null);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [category, column]);

  const reading = (chart: ChartKind) =>
    line && priority && category && column
      ? estimatePriorityDate({ priorityDate: priority.date, category, country: column, chart, bulletins: bulletinsOf(line) })
      : null;
  const finalAction = reading("finalAction");
  const datesForFiling = reading("datesForFiling");

  return (
    <section aria-label="Visa bulletin line" className="detail-card">
      <div className="detail-card-head ch-muted">
        <h2 className="flex items-center gap-1.5">
          <CalendarCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Visa bulletin line
        </h2>
      </div>
      <div className="space-y-3 p-4 text-sm">
        {category && column ? (
          <>
            <p className="font-heading text-lg font-bold">
              <KeepWhole>{lineName(category, column)}</KeepWhole>
            </p>{" "}
            <p className="text-soft">
              {keepWhole(
                priority
                  ? `Priority date ${fmtISODate(priority.date)}, the ${priority.from === "eta9089" ? "ETA 9089's" : "I-140's"} filing day.`
                  : "The priority date is the ETA 9089's filing day (the I-140's without a labor certification). Add it to read the line.",
              )}
            </p>{" "}
            {failed ? (
              <p className="text-data-warn-ink">The bulletin couldn&rsquo;t be read just now. Try again in a minute.</p>
            ) : finalAction && datesForFiling ? (
              <ul className="space-y-1.5">
                <li>{keepWhole(chartSentence("finalAction", finalAction))}</li>{" "}
                <li>{keepWhole(chartSentence("datesForFiling", datesForFiling))}</li>{" "}
                <li className="text-soft">
                  {keepWhole(
                    `From the ${finalAction.asOfBulletin ?? "newest"} bulletin. The Final Action chart says when a green card can be approved; USCIS says each month which chart decides when an I-485 can be filed.`,
                  )}
                </li>
              </ul>
            ) : priority ? (
              <p className="text-soft">Reading the bulletin&hellip;</p>
            ) : null}
          </>
        ) : (
          <p className="text-soft">
            {keepWhole("Add the preference category and the country of birth in the case form to name the line.")}
          </p>
        )}
      </div>
    </section>
  );
}

export function GreenCardTab({ caseData }: GreenCardTabProps) {
  const path = greenCardPathOf(caseData);
  const head = path === "consular" ? "ch-consular" : path === "adjustment" ? "ch-i485" : "ch-muted";
  const Icon = path === "consular" ? AirplaneTiltIcon : IdentificationCardIcon;
  const chargeability = chargeabilityOf(caseData);

  return (
    <div className="space-y-6">
      <Link href={buildEditSectionUrl(caseData._id, "greenCard")} className="detail-card-link" title="Edit in case form">
        <div className="detail-card">
          <div className={`detail-card-head ${head}`}>
            <h2 className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <KeepWhole>{path ? GREEN_CARD_PATH_LABELS[path] : "The green card"}</KeepWhole>
            </h2>{" "}
            <span className="head-badge">{caseData.cardReceivedDate ? "Card received" : path ? "In progress" : "Not started"}</span>
          </div>

          <div className="detail-subhead">The case</div>
          <div className="field-grid" style={{ padding: 0, borderTop: "1px solid var(--border)" }}>
            <div className="field-cell">
              <div className="fc-label">Preference category</div>
              <div className={`fc-val ${!caseData.ebCategory ? "dim" : ""}`}>
                {caseData.ebCategory ? keepWhole(EB_CATEGORY_LABELS[caseData.ebCategory]) : caseData.i140Category || "-"}
              </div>
            </div>
            <div className="field-cell">
              <div className="fc-label">Country of birth</div>
              <div className={`fc-val ${!caseData.countryOfBirth ? "dim" : ""}`}>
                {caseData.countryOfBirth ? countryName(caseData.countryOfBirth) : "-"}
              </div>
            </div>
            <div className="field-cell">
              <div className="fc-label">Chargeability</div>
              <div className={`fc-val ${!chargeability ? "dim" : ""}`}>
                {chargeability ? countryName(chargeability) : "-"}
              </div>
            </div>
          </div>

          {path === "adjustment" ? (
            <>
              <div className="detail-subhead" style={{ borderTop: "1px solid var(--border)" }}><KeepWhole>{"I-485"}</KeepWhole></div>
              <Cells rows={ADJUSTMENT_ROWS} caseData={caseData} />
              <div className="detail-subhead" style={{ borderTop: "1px solid var(--border)" }}>
                Work permit and travel document
              </div>
              <Cells rows={PERMIT_ROWS} caseData={caseData} />
            </>
          ) : null}
          {path === "consular" ? (
            <>
              <div className="detail-subhead" style={{ borderTop: "1px solid var(--border)" }}>The consulate</div>
              <Cells rows={CONSULAR_ROWS} caseData={caseData} />
            </>
          ) : null}
          {path ? (
            <>
              <div className="detail-subhead" style={{ borderTop: "1px solid var(--border)" }}>The card</div>
              <Cells rows={CARD_ROWS} caseData={caseData} />
            </>
          ) : (
            <div className="detail-status-bar">
              <span>
                {keepWhole("Choose the I-485 in the US or a visa at a consulate in the case form, and the steps appear here.")}
              </span>
            </div>
          )}
        </div>
      </Link>

      <BulletinLineCard caseData={caseData} />
    </div>
  );
}
