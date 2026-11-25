import { YearlyPayNote } from "@/components/data/YearlyPayNote";
import { FinePrint } from "@/components/data/FinePrint";
import { PageSection } from "@/components/data/PageSection";
import { FilingRows } from "@/components/entities/FilingRows";
import {
  PERM_AFTER_WAGE_MONTHS,
  WAGE_REQUEST_LOOKBACK_MONTHS,
  WAGE_REQUESTS_SHOWN,
  type EmployerPermCases as FoundPerm,
  type EmployerWageRequests as Found,
} from "@/lib/employerWageRequests";
import { formatWage } from "@/lib/wageFormat";
import { MEASURED, RECRUITMENT_SLACK_DAYS, topRightRate, TYPICAL_GAP_DAYS } from "@/lib/wageLink";

/** The rules' reasons as the page says them (lib/wageLink.ts names them). */
const RULED_OUT_WORDS: Record<string, string> = {
  "decided after the case was filed": "decided after this case was filed",
  "expired too long before the case was filed": `expired more than ${RECRUITMENT_SLACK_DAYS} days before this case was filed`,
};

const pct = (r: number) => `${(r * 100).toFixed(r >= 0.99 ? 1 : 0)}%`;

/**
 * A pending PERM case's likely wage request: the employer's PERM wage requests for the same job title with a
 * wage issued by the day the case was filed. DOL's live record doesn't say which one the case used (its
 * published file does, once the case is decided), so the lede says "very likely one of these", each row links
 * its own page, and the rule behind the list folds under "Why these". The rows are the site's filings table
 * (FilingRows), dated by the day DOL issued the wage, which is what decides whether a request could be it.
 */
export function EmployerWageRequests({
  found,
  employerName,
  jobTitle,
}: {
  found: Found | null;
  employerName: string | null;
  jobTitle: string | null;
}) {
  if (!found || found.rows.length === 0) return null;
  const { rows, more } = found;
  const likely = found.mostLikely ? rows.find((r) => r.caseNumber === found.mostLikely) ?? null : null;
  const out = (found.ruledOut ?? []).filter((r) => r.count > 0);
  const outCount = out.reduce((n, r) => n + r.count, 0);
  const left = more ? Math.max(rows.length + 1, 6) : rows.length;
  const rate = topRightRate(left);
  const who = employerName?.trim() || "the employer";
  const job = jobTitle?.trim() ? `“${jobTitle.trim()}”` : "this job";
  return (
    <PageSection
      title="The wage request behind it"
      id="wage-request"
      lede={
        likely
          ? `Most likely ${likely.caseNumber}: the only request these rules leave${rate ? `, and on decided cases that was the case’s own ${pct(rate)} of the time` : ""}. DOL names it once the case is decided.`
          : `This case’s wage request is very likely one of these${more ? ", or another the employer filed for the job" : ""}, likeliest first${rate ? `: on decided cases with as many left, the first was it ${pct(rate)} of the time` : ""}. DOL names it once the case is decided.`
      }
    >
      <FilingRows
        withWage
        dateLabel="Wage issued"
        rows={rows.map((r) => {
          const wage = formatWage(r.wage, r.wageUnit);
          return {
            caseNumber: r.caseNumber,
            job: r.jobTitle,
            // The day the wage was issued, or blank: a filing day under this heading would be a wrong date.
            date: r.decided,
            status: r.status,
            wage: wage ? (
              <>
                {wage}
                <YearlyPayNote wage={r.wage} unit={r.wageUnit} short />
              </>
            ) : null,
          };
        })}
      />{" "}
      <FinePrint summary="Why these" className="mt-3">
        <p>
          These are the PERM wage requests {who} filed for {job} on which DOL issued a wage by the day this case was filed,
          from the {WAGE_REQUEST_LOOKBACK_MONTHS} months before it.
          {more ? ` There were more than ${WAGE_REQUESTS_SHOWN}, so these are the likeliest of them.` : ""}
        </p>{" "}
        <p>
          A request still waiting, withdrawn, or decided after the filing is left out, because a PERM case is filed on a wage
          DOL has already issued. So is one that expired more than {RECRUITMENT_SLACK_DAYS} days before the filing (recruitment
          has to begin while the wage is valid).
          {outCount > 0
            ? ` For this case that set aside ${outCount.toLocaleString("en-US")}: ${out
                .map((r) => `${r.count.toLocaleString("en-US")} ${RULED_OUT_WORDS[r.why] ?? r.why}`)
                .join(", ")}.`
            : ""}
        </p>{" "}
        <p>
          The rest are ordered first by how many other PERM cases used the same request shortly before this one was filed
          (employers reuse one wage request for several workers in the same job), then by how close the wage’s day is to{" "}
          {TYPICAL_GAP_DAYS} days before the filing, the usual gap on decided cases.
          {MEASURED
            ? ` Checked on ${MEASURED.cases.toLocaleString("en-US")} decided cases (${MEASURED.on}), whose own request DOL names.`
            : ""}{" "}
          DOL’s published file names the case’s own request once the case is decided.
        </p>
      </FinePrint>
    </PageSection>
  );
}

/**
 * The reverse, on a wage request's page: the employer's PERM cases for the same job title filed after DOL issued
 * its wage, shown when no decided PERM case names it yet (DOL's file names it only once the PERM is decided).
 */
export function EmployerPermCasesForWage({
  found,
  employerName,
  jobTitle,
}: {
  found: FoundPerm | null;
  employerName: string | null;
  jobTitle: string | null;
}) {
  if (!found || found.rows.length === 0) return null;
  const { rows, more } = found;
  const who = employerName?.trim() || "the employer";
  const job = jobTitle?.trim() ? `“${jobTitle.trim()}”` : "this job";
  return (
    <PageSection
      title="The PERM case it may support"
      id="perm-cases"
      lede="The PERM case this wage supports is very likely one of these. DOL names it only once that case is decided."
    >
      <FilingRows rows={rows.map((r) => ({ caseNumber: r.caseNumber, job: jobTitle, date: r.filed, status: r.status }))} />{" "}
      <FinePrint summary="Why these" className="mt-3">
        <p>
          These are the PERM cases {who} filed for {job} in the {PERM_AFTER_WAGE_MONTHS} months after DOL issued this
          wage.
          {more ? ` There were more than ${WAGE_REQUESTS_SHOWN}, so these are the newest.` : ""}
        </p>{" "}
        <p>A PERM case is filed on a wage DOL has already issued, so nothing filed before that day is listed.</p>
      </FinePrint>
    </PageSection>
  );
}
