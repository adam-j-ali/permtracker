import "server-only";

import { softFail } from "@/lib/softRead";
import { rows } from "./client";
import { linkableSlugs } from "./entityLinks";
import { getPwdDetail, type PwdDetail } from "./pwdDetail";

/**
 * The job-level fields DOL's PERM file prints for a decided case that its decision section didn't show: the law firm,
 * the industry, the worksite city, the education the job required, whether the employer reported layoffs, and the
 * wage request it names, with that determination's level and requirements (`pwd_cases`, through `pwd_number`).
 * Nothing about the worker as a person (citizenship, birth country, schooling) is read: those belong in aggregates.
 *
 * The current files' table first, then FY2008 to FY2023's (`perm_cases_history`), which carries the same job fields.
 * An older case's wage request is its file's own (FY2016 on: the number in DOL's older form, the prevailing wage, its
 * level and dates), read apart so a table that hasn't gained those columns costs only them. Keyed reads by case
 * number; a failed read is null, so the page keeps its decision section.
 *
 * A current case's firm slug is always its page's. An older case's is its page's when the firm has one, else the
 * firm's own name (`firm_slug_for` in scripts/ingest_perm_history.py, so the rankings count the firm), and it links
 * only once `linkableSlugs` finds the page; a check that fails keeps the link, as `keepLinkableSlugs` does.
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
  /** DOL's "supervised recruitment required" (RECR_INFO_RECRUIT_SUPERVISED_REQ); null where the file doesn't say. */
  supervised: boolean | null;
  /** An older case's own wage request, as its file printed it; null for a current case or a file that printed none. */
  olderPwd: OlderWageRequest | null;
}

/** The wage request DOL's FY2016 to FY2023 PERM files print beside a case (sweep item 1). */
export interface OlderWageRequest {
  /** In DOL's older form (P10014343361482), which no wage request table the site reads holds. */
  number: string | null;
  /** The prevailing wage, a year's worth. */
  wage: number | null;
  /** As printed: "Level III", or a bare "III". */
  level: string | null;
  determined: string | null;
  expires: string | null;
}

const text = (v: unknown) => (v == null || v === "" ? null : String(v));

async function olderWageRequest(caseNumber: string): Promise<OlderWageRequest | null> {
  const got = await Promise.resolve(
    rows<Record<string, unknown>>(
      "SELECT pw_number, pw_wage, pw_level, pw_determined, pw_expires FROM perm_cases_history WHERE case_number = ? LIMIT 1",
      [caseNumber],
    ),
  ).catch(softFail("permCaseDetail.olderPwd", null));
  const r = got?.[0];
  if (!r) return null;
  const wage = r.pw_wage == null || r.pw_wage === "" ? null : Number(r.pw_wage);
  const out: OlderWageRequest = {
    number: text(r.pw_number),
    wage: wage !== null && Number.isFinite(wage) && wage > 0 ? wage : null,
    level: text(r.pw_level),
    determined: text(r.pw_determined),
    expires: text(r.pw_expires),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

export async function getPermCaseDetail(caseNumber: string): Promise<PermCaseDetail | null> {
  const cols = "attorney_name, attorney_slug, naics, worksite_city, job_education, layoff";
  const got = await rows<Record<string, unknown>>(`SELECT ${cols}, pwd_number, recr_supervised FROM perm_cases WHERE case_number = ? LIMIT 1`, [
    caseNumber,
  ]).catch(softFail("permCaseDetail.read", null));
  const older =
    got && !got.length
      ? await rows<Record<string, unknown>>(`SELECT ${cols} FROM perm_cases_history WHERE case_number = ? LIMIT 1`, [caseNumber]).catch(
          softFail("permCaseDetail.readHistory", null),
        )
      : null;
  const r = got?.[0] ?? older?.[0];
  if (!r) return null;
  let attorneySlug = text(r.attorney_slug);
  if (attorneySlug && !got?.length) {
    const pages = await linkableSlugs("attorney", [attorneySlug]).catch(softFail("permCaseDetail.firmPage", null));
    if (pages && !pages.has(attorneySlug)) attorneySlug = null;
  }
  const olderPwd = older?.length ? await olderWageRequest(caseNumber) : null;
  const pwdNumber = text(r.pwd_number);
  const layoff = text(r.layoff);
  return {
    attorneyName: text(r.attorney_name),
    attorneySlug,
    naics: text(r.naics),
    worksiteCity: text(r.worksite_city),
    jobEducation: text(r.job_education),
    layoff: layoff === null ? null : /^(y|yes|true|1)$/i.test(layoff),
    pwdNumber,
    pwd: pwdNumber ? await getPwdDetail(pwdNumber) : null,
    supervised: text(r.recr_supervised) === null ? null : /^(y|yes|true|1)$/i.test(String(r.recr_supervised)),
    olderPwd,
  };
}
