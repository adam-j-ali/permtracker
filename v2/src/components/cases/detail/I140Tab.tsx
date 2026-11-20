"use client";

import { ToneBadge } from "@/components/ui/badge";
import Link from "next/link";
import { ClockIcon, ShieldIcon } from "@phosphor-icons/react";
import { buildEditUrl, buildEditSectionUrl } from "@/lib/cases/editDeepLinks";
import type { CaseDetailData } from "./case-detail-types";
import { fmtISODate, computeWindowStatus } from "./case-detail-utils";
import { WindowCard } from "./WindowCard";
import { ResponseEntryGrid } from "./ResponseEntryGrid";
import { ReportedI140ForCase } from "./ReportedI140ForCase";
import { PublicNumber } from "./PublicNumber";
import { BULLETIN_CATEGORIES_HREF, receiptPageHref } from "@/lib/cases/publicLinks";
import { casePriorityDate } from "@/lib/perm";

interface I140TabProps {
  caseData: CaseDetailData;
}

export function I140Tab({ caseData }: I140TabProps) {
  const rfeEntries = caseData.rfeEntries || [];

  const isFiled = !!caseData.i140FilingDate;
  const priority = casePriorityDate(caseData);
  const isApproved = !!caseData.i140ApprovalDate;
  const isDenied = !!caseData.i140DenialDate;
  const statusLabel = isApproved ? "Approved" : isDenied ? "Denied" : isFiled ? "Filed" : "Pending";

  // I-140 filing window: from ETA 9089 certification to expiration
  const ws = computeWindowStatus(
    caseData.eta9089CertificationDate,
    caseData.eta9089ExpirationDate,
    { filed: isFiled || isApproved, filedLabel: caseData.i140FilingDate ? `I-140 filed ${fmtISODate(caseData.i140FilingDate)}` : "I-140 filed" },
  );

  return (
    <div className="space-y-6">
      {/* I-140 Filing Window Card */}
      {ws && (
        <WindowCard
          ws={ws}
          title="I-140 filing window"
          stageColor="var(--stage-i140)"
          startDate={caseData.eta9089CertificationDate}
          endDate={caseData.eta9089ExpirationDate}
        />
      )}

      {/* I-140 Petition Card */}
      <div>
        <Link href={buildEditUrl(caseData._id, "i140FilingDate")} className="detail-card-link" title="Edit in case form">
          <div className="detail-card">
            <div className="detail-card-head ch-i140">
              <h2 className="flex items-center gap-1.5">
                <ShieldIcon className="h-3.5 w-3.5" />
                I-140 petition
              </h2>{" "}
              <span className="head-badge">{statusLabel}</span>
            </div>

            {/* Filing Details */}
            <div className="detail-subhead">Filing details</div>
            <div className="field-grid" style={{ padding: 0, borderTop: "1px solid var(--border)" }}>
              <div className="field-cell">
                <div className="fc-label">Category</div>
                <div className={`fc-val ${!caseData.i140Category ? "dim" : ""}`}>
                  <PublicNumber value={caseData.i140Category} href={caseData.i140Category ? BULLETIN_CATEGORIES_HREF : null} />
                </div>
              </div>
              <div className="field-cell">
                <div className="fc-label">Filing date</div>
                <div className={`fc-val num ${!isFiled ? "dim" : ""}`}>{fmtISODate(caseData.i140FilingDate)}</div>
              </div>
              <div className="field-cell">
                <div className="fc-label">Priority date</div>
                <div className={`fc-val num ${!priority ? "dim" : ""}`} title={priority ? (priority.from === "eta9089" ? "The ETA 9089's filing day" : "The I-140's filing day") : undefined}>
                  {priority ? fmtISODate(priority.date) : "-"}
                </div>
              </div>
              <div className="field-cell">
                <div className="fc-label">Premium processing</div>
                <div className={`fc-val ${!caseData.i140PremiumProcessing ? "dim" : ""}`}>
                  {caseData.i140PremiumProcessing ? "Yes" : "No"}
                </div>
              </div>
            </div>

            {/* Receipt & Processing */}
            <div className="detail-subhead" style={{ borderTop: "1px solid var(--border)" }}>Receipt &amp; Processing</div>
            <div className="field-grid" style={{ padding: 0, borderTop: "1px solid var(--border)" }}>
              <div className="field-cell">
                <div className="fc-label">Receipt date</div>
                <div className={`fc-val num ${!caseData.i140ReceiptDate ? "dim" : ""}`}>{fmtISODate(caseData.i140ReceiptDate)}</div>
              </div>
              <div className="field-cell">
                <div className="fc-label">Receipt number</div>
                <div className={`fc-val fc-val-text mono ${!caseData.i140ReceiptNumber ? "dim" : ""}`} title={caseData.i140ReceiptNumber || undefined}>
                  <PublicNumber value={caseData.i140ReceiptNumber} href={receiptPageHref(caseData.i140ReceiptNumber)} />
                </div>
              </div>
              <div className="field-cell">
                <div className="fc-label">Service center</div>
                <div className={`fc-val fc-val-text mono ${!caseData.i140ServiceCenter ? "dim" : ""}`} title={caseData.i140ServiceCenter || undefined}>
                  {caseData.i140ServiceCenter || "-"}
                </div>
              </div>
            </div>

            {/* Outcome */}
            <div className="detail-subhead" style={{ borderTop: "1px solid var(--border)" }}>Outcome</div>
            <div className="field-grid" style={{ padding: 0, borderTop: "1px solid var(--border)" }}>
              <div className="field-cell">
                <div className="fc-label">Approval date</div>
                <div className={`fc-val num ${!isApproved ? "dim" : ""}`}>{fmtISODate(caseData.i140ApprovalDate)}</div>
              </div>
              <div className="field-cell">
                <div className="fc-label">Denial date</div>
                <div className={`fc-val num ${!isDenied ? "dim" : ""}`}>{fmtISODate(caseData.i140DenialDate)}</div>
              </div>
              <div className="field-cell">
                <div className="fc-label">Status</div>
                <div className="fc-val">
                  <ToneBadge tone={isApproved ? "good" : isDenied ? "bad" : "flat"}>
                    {statusLabel}
                  </ToneBadge>
                </div>
              </div>
            </div>

            {/* Status Summary */}
            {!isApproved && !isDenied && (
              <div className="detail-status-bar">
                <ClockIcon className="h-4 w-4 shrink-0" style={{ color: "var(--stage-i140-ink)" }} />
                <span>
                  {isFiled
                    ? "I-140 filed. Awaiting USCIS decision."
                    : caseData.eta9089CertificationDate
                      ? "PERM certified. Ready to file I-140 with USCIS."
                      : "Awaiting PERM certification before I-140 can be filed with USCIS."}
                </span>
              </div>
            )}
          </div>
        </Link>
      </div>

      {/* How I-140s like this one are going, from every case people reported */}
      <ReportedI140ForCase
        category={caseData.i140Category}
        premium={caseData.i140PremiumProcessing}
        filedOn={caseData.i140FilingDate}
        decidedOn={caseData.i140ApprovalDate || caseData.i140DenialDate}
      />{" "}

      {/* RFE Section */}
      <Link href={buildEditSectionUrl(caseData._id, "i140")} className="detail-card-link" title="Edit in case form">
        <ResponseEntryGrid
          type="RFE"
          subtitle="USCIS"
          entries={rfeEntries}
          emptyIcon={<ShieldIcon className="h-8 w-8" />}
          emptyDescription="Entries will appear here if USCIS issues a request during I-140 review."
        />
      </Link>
    </div>
  );
}
