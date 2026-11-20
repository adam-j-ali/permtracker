import "server-only";

import { softFail } from "@/lib/softRead";
import { rows } from "./client";

/**
 * The parts of a decided wage request DOL's file prints that the shared disclosed-row reader leaves out, because
 * the LCA and seasonal tables don't carry them: the level DOL set, its own expiration date and determination day,
 * the job's requirements as the request stated them (and the alternative ones), the ACWIA flag, and the worksite city
 * and industry, so either read fills a field the other lacks.
 * One keyed read by case number; null when the file holds no such row, and a failed read is null too, so the page
 * keeps what the shared reader gave.
 */
export interface PwdDetail {
  level: string | null;
  /** DOL's file's date, a day before the determination's own on 99.8% of rows: never shown as the expiry. */
  expires: string | null;
  determinedOn: string | null;
  education: string | null;
  experienceMonths: number | null;
  altEducation: string | null;
  altExperienceMonths: number | null;
  /** ACWIA: an institution of higher education or a related nonprofit, which DOL prices on a separate survey. */
  acwia: string | null;
  worksiteCity: string | null;
  naics: string | null;
}

const text = (v: unknown) => (v == null || v === "" ? null : String(v));
const int = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export async function getPwdDetail(caseNumber: string): Promise<PwdDetail | null> {
  const got = await rows<Record<string, unknown>>(
    `SELECT wage_level, pw_expires, determined_on, req_education, req_experience_months, alt_education,
            alt_experience_months, acwia, acwia_kind, worksite_city, naics
       FROM pwd_cases WHERE case_number = ? LIMIT 1`,
    [caseNumber],
  ).catch(softFail("pwdDetail.read", null));
  const r = got?.[0];
  if (!r) return null;
  const acwia = text(r.acwia);
  return {
    level: text(r.wage_level),
    expires: text(r.pw_expires)?.slice(0, 10) ?? null,
    determinedOn: text(r.determined_on)?.slice(0, 10) ?? null,
    education: text(r.req_education),
    experienceMonths: int(r.req_experience_months),
    altEducation: text(r.alt_education),
    altExperienceMonths: int(r.alt_experience_months),
    acwia: acwia && /^(y|yes|true|1)$/i.test(acwia) ? text(r.acwia_kind) ?? "Yes" : null,
    worksiteCity: text(r.worksite_city),
    naics: text(r.naics),
  };
}
