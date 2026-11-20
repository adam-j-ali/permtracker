/**
 * Where a case's own numbers and codes are on the public site: a DOL number's case page, a USCIS receipt's lookup, a
 * job code's wage levels. Null for anything that isn't one, so a typo or an internal reference stays plain text.
 */
import { normaliseCaseNumber } from "@/lib/caseNumberShape";
import { SOC_CODE_RE, socGroup } from "@/lib/socCode";
import { normaliseReceipt } from "@/lib/uscis/receipt";

export function dolCasePageHref(n: string | null | undefined): string | null {
  const num = n ? normaliseCaseNumber(n) : null;
  return num ? `/perm-case-status?case=${encodeURIComponent(num)}` : null;
}

export function receiptPageHref(n: string | null | undefined): string | null {
  const receipt = n ? normaliseReceipt(n) : null;
  return receipt ? `/uscis-case-status?receipt=${encodeURIComponent(receipt)}` : null;
}

/** By the wage-levels page's own reading of a code (SOC_CODE_RE, socGroup). */
export function socWagePageHref(code: string | null | undefined): string | null {
  const c = code?.trim();
  const group = c && SOC_CODE_RE.test(c) ? socGroup(c) : null;
  return group ? `/tools/wage-levels?soc=${encodeURIComponent(group)}` : null;
}

/** The visa bulletin's category pages, where each category's lines by country are. */
export const BULLETIN_CATEGORIES_HREF = "/visa-bulletin/categories";
