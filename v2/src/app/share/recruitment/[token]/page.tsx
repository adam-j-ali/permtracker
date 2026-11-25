import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { shortDate, longDate } from "@convex/lib/months";
import { CONTACT_METHODS, outcomeLabel } from "@convex/lib/perm/recruitment/applicantReport";
import { isShareToken } from "@convex/lib/shareToken";
import { PrintButton } from "@/components/ui/print-button";
import { readSharedRecord, type SharedRecord } from "@/lib/sharedRecruitmentRecord";
import { emailStamp } from "@/lib/time";
import { RecordViewed } from "./RecordViewed";
import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";
import { caseInSentence } from "@convex/lib/caseLabel";

/**
 * A case's recruitment record, shared by the attorney's office with its client through a private link
 * (convex/recruitmentShares.ts). Read-only, no sign-in, and outside the site's indexed pages: no header or menus, not
 * in the sitemap, the search palette or llms.txt. next.config.ts gives /share/* no referrer, a noindex and nofollow
 * header and no Ahrefs script; PostHog sends nothing from it (isPrivatePageEvent). Rendered on every request, so
 * Next sends it private and no-store, and the client sees the record as it is now.
 *
 * Everything the page can show is what recordByToken returns: the employer, the job title, the steps and their
 * dates, the filing window and the applicant log. A link that's off, unknown or malformed is a 404 (not-found.tsx);
 * a failed read throws to the error screen (../../error.tsx), never "this link is off".
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recruitment record",
  description: "A read-only recruitment record, shared by an attorney's office through PERM Tracker.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  // A chat app's preview of the link names what it is, never the site's homepage pitch.
  openGraph: {
    siteName: "PERM Tracker",
    type: "website",
    title: "A recruitment record",
    description: "Shared by an attorney's office through PERM Tracker. Read-only.",
  },
  twitter: { card: "summary", title: "A recruitment record", description: "Shared by an attorney's office through PERM Tracker. Read-only." },
};

type Dates = SharedRecord["steps"][number]["dates"];
type Applicant = SharedRecord["applicants"][number];

function span(d: Dates[number]): string {
  const start = shortDate(d.start) ?? d.start;
  const end = d.end ? (shortDate(d.end) ?? d.end) : null;
  return end ? `${start} to ${end}` : start;
}

/** "Jan 5, 2026 to Feb 4, 2026", or several dates joined; "No date yet" for a step not entered. */
function datesText(dates: Dates): string {
  if (dates.length === 0) return "No date yet";
  const parts = dates.map(span);
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const day = (iso: string | null) => (iso ? (shortDate(iso) ?? iso) : "-");

function contactLabel(a: Applicant): string | null {
  return a.contactMethod ? (CONTACT_METHODS.find((m) => m.key === a.contactMethod)?.label ?? null) : null;
}

/** When this copy was read: the page is rendered on each request, so it's the moment the reader asked. */
function shownAt(): string {
  return `Shown as of ${emailStamp(Date.now())}.`;
}

function logSummary(applicants: readonly Applicant[]): string {
  const n = applicants.length;
  const hired = applicants.filter((a) => a.outcome === "hired").length;
  const pending = applicants.filter((a) => a.outcome === "pending").length;
  return `${n} ${n === 1 ? "applicant" : "applicants"}: ${hired} hired, ${pending} still being considered and ${n - hired - pending} not hired.`;
}

export default async function SharedRecruitmentRecordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // A link of the wrong shape is never sent to Convex.
  const record = isShareToken(token) ? await readSharedRecord(token) : null;
  if (!record) notFound();

  const filing = record.filingWindow;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14 print:max-w-none print:px-0 print:py-0">
      <p className="font-heading text-lg font-bold">PERM Tracker</p>{" "}
      <h1 className="mt-8 font-heading text-3xl font-bold">Recruitment record</h1>{" "}
      <p className="mt-3 max-w-prose text-lg text-soft">
        {`The recruitment record for ${caseInSentence(record, "this case")}, shared by your attorney's office through PERM Tracker. It updates as they work.`}
      </p>{" "}
      <p className="mt-3 text-sm text-muted-foreground">{shownAt()}</p>{" "}
      <PrintButton className="mt-4" />{" "}

      <section aria-labelledby="shared-steps" className="mt-12 print:mt-8">
        <h2 id="shared-steps" className="font-heading text-2xl font-bold">Recruitment steps</h2>{" "}
        <ol aria-labelledby="shared-steps" className="mt-4 border-t-2 border-foreground">
          {record.steps.map((s) => (
            <li key={s.key} className="flex flex-col gap-1 border-b border-border py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
              <span className="font-semibold">{keepWhole(s.label)}</span>{" "}
              <span className={`tabular-nums sm:text-right ${s.dates.length ? "" : "text-muted-foreground"}`}>{datesText(s.dates)}</span>{" "}
            </li>
          ))}
        </ol>
      </section>{" "}

      {filing ? (
        <section aria-labelledby="shared-window" className="mt-12 print:mt-8">
          <h2 id="shared-window" className="font-heading text-2xl font-bold">ETA 9089 filing window</h2>{" "}
          <p className="mt-2 max-w-prose text-soft">
            <KeepWhole>
              {"The days in which the application for labor certification, Form ETA-9089, can be filed with the " +
                "Department of Labor."}
            </KeepWhole>
          </p>{" "}
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="bg-tint p-4">
              <dt className="text-sm text-muted-foreground">Opens</dt>{" "}
              <dd className="mt-1 text-lg font-semibold">{longDate(filing.opens) ?? "Not known yet"}</dd>
            </div>{" "}
            <div className="bg-tint p-4">
              <dt className="text-sm text-muted-foreground">Closes</dt>{" "}
              <dd className="mt-1 text-lg font-semibold">{longDate(filing.closes) ?? "Not known yet"}</dd>
            </div>
          </dl>
        </section>
      ) : null}{" "}

      <section aria-labelledby="shared-log" className="mt-12 print:mt-8">
        <h2 id="shared-log" className="font-heading text-2xl font-bold">Applicant log</h2>{" "}
        {record.applicants.length === 0 ? (
          <p className="mt-2 text-soft">No applicants are logged yet.</p>
        ) : (
          <>
            <p className="mt-2 text-soft">{logSummary(record.applicants)}</p>{" "}
            <table aria-labelledby="shared-log" className="mt-4 w-full border-collapse text-left text-base">
              <thead className="hidden sm:table-header-group">
                <tr className="border-b-2 border-foreground">
                  <th scope="col" className="p-2 pl-0 font-bold">Reference{" "}</th>
                  <th scope="col" className="p-2 font-bold">Applied{" "}</th>
                  <th scope="col" className="p-2 font-bold">Contacted{" "}</th>
                  <th scope="col" className="p-2 font-bold">Outcome{" "}</th>
                  <th scope="col" className="p-2 pr-0 font-bold">Reason{" "}</th>
                </tr>
              </thead>
              <tbody className="block border-t-2 border-foreground sm:table-row-group sm:border-t-0">
                {record.applicants.map((a, i) => {
                  const how = contactLabel(a);
                  return (
                    <tr key={i} className="block border-b border-border py-3 align-top sm:table-row sm:py-0">
                      <th scope="row" className="block p-0 font-semibold sm:table-cell sm:p-2 sm:pl-0">{`${a.ref} `}</th>
                      <td className="block p-0 sm:table-cell sm:p-2">
                        <span className="text-muted-foreground sm:hidden">Applied: </span>
                        {`${day(a.appliedOn)} `}
                      </td>
                      <td className="block p-0 sm:table-cell sm:p-2">
                        <span className="text-muted-foreground sm:hidden">Contacted: </span>
                        {`${day(a.contactedOn)} `}
                        {how ? <span className="block text-sm text-muted-foreground">{`${how} `}</span> : null}
                      </td>
                      <td className="block p-0 sm:table-cell sm:p-2">
                        <span className="text-muted-foreground sm:hidden">Outcome: </span>
                        {`${outcomeLabel(a.outcome)} `}
                      </td>
                      <td className={`${a.reason ? "block" : "hidden"} p-0 sm:table-cell sm:p-2 sm:pr-0`}>
                        <span className="text-muted-foreground sm:hidden">Reason: </span>
                        {a.reason ? `${a.reason} ` : " "}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>{" "}

      <div className="mt-16 border-t-2 border-border pt-6 text-sm text-muted-foreground print:mt-10">
        <p>
          This page is read-only, and only people with its link can open it. Your attorney&apos;s office can turn the link
          off at any time, and questions about the record go to them.
        </p>{" "}
        <p className="mt-2 print:hidden">
          {/* A plain link, so the next page is a fresh load: nothing from this page's address carries over. */}
          <a href="/about" className="link inline-flex min-h-11 items-center">
            About PERM Tracker
          </a>
        </p>
      </div>
      <RecordViewed token={token} />
    </main>
  );
}
