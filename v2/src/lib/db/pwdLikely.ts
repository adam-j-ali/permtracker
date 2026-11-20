import "server-only";

import { socGroup } from "@/lib/socCode";
import { titleKey } from "@/lib/socTitleKey";
import { softFail } from "@/lib/softRead";
import { rows } from "./client";
import { cityGeo, wageLevelsForArea, type WageLevelYear } from "./reference";
import { getSocTitle } from "./socTitles";

/**
 * What DOL will likely set for a wage request it hasn't decided: DOL's live record gives only the employer, the job
 * title and the filing day, so everything here is worked out from what DOL decided before, and labelled an estimate.
 *
 * 1. The employer's own past determinations for the same job title (`pwd_cases`, its employer index), newest first:
 *    the code DOL used, the level, the wage and the worksite. The best evidence there is for the same job.
 * 2. The likely code: the one DOL used most for this employer and title; without those, the code employers file the
 *    title under most often (`soc_titles`, the same lookup as /soc-codes).
 * 3. The area: the worksite of the employer's past determination for the title, as a DOL wage area (`city_geo`).
 * 4. DOL's four wages for the code in that area, newest wage year (`oflc_wage_levels`).
 *
 * Each read is its own: a failed read drops only its part. Null when nothing at all could be worked out.
 */

export interface PastDetermination {
  caseNumber: string;
  determinedOn: string | null;
  socCode: string | null;
  socTitle: string | null;
  level: string | null;
  wage: number | null;
  wageUnit: string | null;
  worksiteCity: string | null;
  worksiteState: string | null;
  /** The requirements the request stated, in DOL's file's words ("Bachelor's", 72). */
  education: string | null;
  experienceMonths: number | null;
}

export interface PwdLikely {
  past: PastDetermination[];
  /** The likely code, and why: the employer's own determinations, or how employers title the job. */
  soc: { code: string; title: string | null; basis: "employer" | "title"; share: number | null } | null;
  area: { code: string; name: string | null; city: string | null; jobs: number } | null;
  levels: WageLevelYear | null;
}

/** The years of an employer's determinations that still say what DOL does for the same job. */
const LOOKBACK_YEARS = 3;

/** The city key `city_geo` is keyed by (scripts/build_entity_detail.py city_key): "ST LOUIS|MO". */
export function cityKey(city: string | null, state: string | null): string | null {
  if (!city || !state) return null;
  const k = city.replace(/\./g, " ").toUpperCase().split(/\s+/).filter(Boolean).join(" ");
  return k ? `${k}|${state.toUpperCase()}` : null;
}

export async function getPwdLikely(employerSlug: string | null, jobTitle: string | null, filed: string | null): Promise<PwdLikely | null> {
  const title = jobTitle?.trim().toUpperCase() ?? "";
  if (!title) return null;
  const since = `${Number((filed ?? new Date().toISOString()).slice(0, 4)) - LOOKBACK_YEARS}-01-01`;
  const past: PastDetermination[] = employerSlug
    ? (
        await rows<Record<string, unknown>>(
          `SELECT case_number, determined_on, decision_date, soc_code, soc_title, wage_level, wage, wage_unit, worksite_city, worksite_state,
                  req_education, req_experience_months
             FROM pwd_cases
            WHERE employer_slug = ? AND received_date >= ? AND upper(trim(job_title)) = ? AND wage IS NOT NULL
            ORDER BY received_date DESC LIMIT 20`,
          [employerSlug, since, title],
        ).catch(softFail("pwdLikely.past", []))
      ).map((r) => ({
        caseNumber: String(r.case_number),
        determinedOn: r.determined_on == null ? (r.decision_date == null ? null : String(r.decision_date)) : String(r.determined_on),
        socCode: r.soc_code == null ? null : String(r.soc_code),
        socTitle: r.soc_title == null ? null : String(r.soc_title),
        level: r.wage_level == null ? null : String(r.wage_level),
        wage: r.wage == null ? null : Number(r.wage),
        wageUnit: r.wage_unit == null ? null : String(r.wage_unit),
        worksiteCity: r.worksite_city == null ? null : String(r.worksite_city),
        worksiteState: r.worksite_state == null ? null : String(r.worksite_state),
        education: r.req_education == null || r.req_education === "" ? null : String(r.req_education),
        experienceMonths: r.req_experience_months == null || !Number.isFinite(Number(r.req_experience_months)) ? null : Number(r.req_experience_months),
      }))
    : [];

  // The code: the employer's own most-used for the title, else the title's most-filed code.
  let soc: PwdLikely["soc"] = null;
  const byCode = new Map<string, { n: number; title: string | null }>();
  for (const p of past) {
    const code = p.socCode ? socGroup(p.socCode) : null;
    if (code) byCode.set(code, { n: (byCode.get(code)?.n ?? 0) + 1, title: p.socTitle });
  }
  const top = [...byCode.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (top) {
    soc = { code: top[0], title: top[1].title, basis: "employer", share: top[1].n / past.length };
  } else {
    const answer = await getSocTitle(titleKey(title)).catch(softFail("pwdLikely.socTitle", null));
    const best = answer?.codes.filter((c) => c.filings > 0).sort((a, b) => b.filings - a.filings)[0];
    if (best) soc = { code: best.soc, title: best.codeTitle, basis: "title", share: best.share };
  }

  // The area: the worksite the employer's past determinations for the title name most often (an employer files one
  // title in several cities: FMR LLC's "Director, Full Stack Engineering" sat in Boston, Westlake and Merrimack).
  const places = new Map<string, { n: number; city: string; state: string }>();
  for (const p of past) {
    const k = cityKey(p.worksiteCity, p.worksiteState);
    if (k) places.set(k, { n: (places.get(k)?.n ?? 0) + 1, city: p.worksiteCity!, state: p.worksiteState! });
  }
  const where = [...places.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  const key = where ? where[0] : null;
  const geo = key ? await cityGeo(key).catch(softFail("pwdLikely.cityGeo", null)) : null;
  const area = geo?.wageArea ? { code: geo.wageArea, name: geo.wageAreaName, city: where ? `${where[1].city}, ${where[1].state}` : null, jobs: where?.[1].n ?? 0 } : null;

  const levels =
    soc && area
      ? ((await wageLevelsForArea(area.code, [soc.code]).catch(softFail("pwdLikely.levels", []))).find((l) => l.soc === soc!.code) ?? null)
      : null;

  if (!past.length && !soc) return null;
  return { past, soc, area, levels };
}
