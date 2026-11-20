"use client";

import { useId, useState } from "react";
import { FileArchiveIcon, FileTextIcon } from "@phosphor-icons/react";

import type { ApplicantEntry, RecruitmentReport } from "@convex/lib/perm/recruitment/applicantReport";
import { Button } from "@/components/ui/button";
import { buildAuditFile, type AuditDocument } from "@/lib/recruitment/auditFile";
import { toast } from "@/lib/toast";

/**
 * The draft recruitment report the log builds (20 CFR 656.17(g)(1)), for the employer or its representative to
 * review and sign, and the one-click audit file: one indexed PDF of the wage determination, the Notice of Filing,
 * each step's proof, the log and the report, made in the browser.
 */
export function RecruitmentReportCard({
  report,
  applicants,
  documents,
  employer,
  position,
  caseNumber,
}: {
  report: RecruitmentReport;
  applicants: readonly ApplicantEntry[];
  documents: readonly AuditDocument[];
  employer: string | null;
  position: string | null;
  caseNumber: string | null;
}) {
  const id = useId();
  const [making, setMaking] = useState(false);

  const download = async () => {
    setMaking(true);
    try {
      const madeOn = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });
      const bytes = await buildAuditFile({
        title: "Recruitment audit file",
        employer,
        position,
        caseNumber,
        madeOn,
        documents,
        applicants,
        report,
      });
      const blob = new Blob([bytes.slice().buffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recruitment-audit-file${employer ? `-${employer.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error("Couldn't make the audit file. Try again.");
    } finally {
      setMaking(false);
    }
  };

  return (
    <section className="detail-card" aria-labelledby={`${id}-h`}>
      <div className="detail-card-head ch-rec">
        <h2 id={`${id}-h`} className="flex items-center gap-1.5">
          <FileTextIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Recruitment report
        </h2>
        <span className="head-badge">Draft</span>
      </div>
      <div className="detail-card-body space-y-4">
        <p className="text-base">
          {report.total
            ? `${report.total} U.S. applicant${report.total === 1 ? "" : "s"} responded. ${report.hired} ${report.hired === 1 ? "was" : "were"} hired, ${report.notHired} ${
                report.notHired === 1 ? "was" : "were"
              } not hired, and ${report.pending} ${report.pending === 1 ? "is" : "are"} still being considered.`
            : "The report fills in as applicants are added to the log."}
        </p>
        {report.groups.length ? (
          <ul className="space-y-3">
            {report.groups.map((g) => (
              <li key={g.key}>
                <h3 className="text-base font-bold">{`${g.label}: ${g.entries.length}`}</h3>{" "}
                <ul className="mt-1 space-y-1 text-base">
                  {g.entries.map((e) => (
                    <li key={e.ref}>{`${e.ref}: ${e.reason?.trim() || "no reason written yet"}`}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}{" "}
        {report.withoutReason.length ? (
          <p className="border-l-4 border-data-warn-ink bg-soft-warn px-4 py-3 text-base" role="status">
            {`Not final yet: ${report.withoutReason.map((e) => e.ref).join(", ")} ${report.withoutReason.length === 1 ? "has" : "have"} no reason written.`}
          </p>
        ) : null}{" "}
        <p className="text-sm text-muted-foreground">
          A draft for the employer or its representative to review and sign, as 20 CFR 656.17(g)(1) asks. The reasons are
          the ones written in the log. PERM Tracker gives general information and isn&apos;t a law firm.
        </p>
        <div>
          <Button type="button" className="min-h-11" disabled={making} onClick={() => void download()}>
            <FileArchiveIcon aria-hidden="true" className="h-4 w-4" /> {making ? "Making the file" : "Download the audit file"}
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            One PDF of the wage determination, the Notice of Filing, each step&apos;s proof, the applicant log and this report,
            with an index. It&apos;s made on this device: the files never leave it. Keep it 5 years from filing (20 CFR 656.10(f)).
          </p>
        </div>
      </div>
    </section>
  );
}
