import "server-only";

import { softFail } from "@/lib/softRead";
import { rows } from "./client";
import { getPwdDetail, type PwdDetail } from "./pwdDetail";

/**
 * The job-level fields DOL's PERM file prints for a decided case that its decision section didn't show: the law firm,
 * the industry, the worksite city, the education the job required, whether the employer reported layoffs, and the
 * wage request it names, with that determination's level and requirements (`pwd_cases`, through `pwd_number`).
 * Nothing about the worker as a person (citizenship, birth country, schooling) is read: those belong in aggregates.
 *
 * Keyed reads by case number; a failed read is null, so the page keeps its decision section.
 */
export interface PermCaseDetail {
  attorneyName: string | null;
  attorneySlug: string | null;
  naics: string | null;
  worksiteCity: string | null;
  jobEducation: string | null;
  layoff: boolean | null;
  pwdNumber: string | null;
  pwd: PwdDetail | null;
}

const text = (v: unknown) => (v == null || v === "" ? null : String(v));

export async function getPermCaseDetail(caseNumber: string): Promise<PermCaseDetail | null> {
  const got = await rows<Record<string, unknown>>(
    `SELECT attorney_name, attorney_slug, naics, worksite_city, job_education, layoff, pwd_number
       FROM perm_cases WHERE case_number = ? LIMIT 1`,
    [caseNumber],
  ).catch(softFail("permCaseDetail.read", null));
  const r = got?.[0];
  if (!r) return null;
  const pwdNumber = text(r.pwd_number);
  const layoff = text(r.layoff);
  return {
    attorneyName: text(r.attorney_name),
    attorneySlug: text(r.attorney_slug),
    naics: text(r.naics),
    worksiteCity: text(r.worksite_city),
    jobEducation: text(r.job_education),
    layoff: layoff === null ? null : /^(y|yes|true|1)$/i.test(layoff),
    pwdNumber,
    pwd: pwdNumber ? await getPwdDetail(pwdNumber) : null,
  };
}
