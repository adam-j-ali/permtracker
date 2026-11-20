import { NextResponse } from "next/server";

import { AREA_RE, readWageRates, WAGE_DOWNLOADS_PAGE, WAGE_SEARCH_PAGE, WAGE_SEARCH_URL, wageSearchBody } from "@/lib/wageLevels";
import { storedWageLevels } from "@/lib/db/reference";
import { SOC_CODE_RE, socGroup } from "@/lib/socCode";

/**
 * GET /api/wage-levels?soc=15-1252&area=31080&year=2026
 *
 * One DOL wage-search request, validated, capped and cached. DOL answers in
 * about a quarter of a second; the CDN keeps each answer a day, so a popular
 * occupation costs DOL one request a day per area. Inputs are two short
 * patterns and a four-digit year, checked before anything is fetched. The
 * site's firewall rate-limits /api/* per address on top of this.
 *
 * When DOL's search fails (an error, a time-out, an answer this reader doesn't know), the same levels come from our
 * stored copy of DOL's published wage file for that year (`from: "file"`), cached an hour so the live answer returns
 * soon. Only when that copy can't answer either does the reader get the failure. DOL's own "no wage" is kept as is.
 */

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const soc = (url.searchParams.get("soc") ?? "").trim();
  const area = (url.searchParams.get("area") ?? "").trim();
  const yearRaw = (url.searchParams.get("year") ?? "").trim();
  const year = Number(yearRaw);
  if (!SOC_CODE_RE.test(soc) || !AREA_RE.test(area) || !/^\d{4}$/.test(yearRaw) || year < 2020 || year > 2035) {
    return NextResponse.json({ ok: false, message: "soc, area and year are required: an SOC code, a BLS area code and a series year." }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(WAGE_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Origin: "https://flag.dol.gov", Referer: WAGE_SEARCH_PAGE },
      body: JSON.stringify(wageSearchBody(soc, Number(area), year)),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return (await fromFile(soc, area, year)) ?? NextResponse.json({ ok: false, message: `DOL answered ${res.status}.` }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    const read = readWageRates(await res.json());
    if (read.kind === "unreadable") {
      // A changed answer from DOL must never read as "DOL publishes no wage": say it couldn't be read, cache nothing.
      console.error("[wage-levels] DOL's wage search answered in a shape this reader doesn't know", { soc: socGroup(soc), area });
      const stored = await fromFile(soc, area, year);
      if (stored) return stored;
      return NextResponse.json(
        { ok: false, message: "DOL's answer couldn't be read just now. Try again in a minute." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const levels = read.kind === "levels" ? read.levels : null;
    if (!levels) {
      return NextResponse.json(
        { ok: true, soc: socGroup(soc), area: Number(area), seriesYear: year, levels: null, source: WAGE_SEARCH_PAGE, message: "DOL publishes no wage for that occupation in that area for that series." },
        { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
      );
    }
    return NextResponse.json(
      { ok: true, soc: socGroup(soc), area: Number(area), seriesYear: year, levels, source: WAGE_SEARCH_PAGE },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" } },
    );
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "AbortError";
    const stored = await fromFile(soc, area, year);
    if (stored) return stored;
    return NextResponse.json({ ok: false, message: timedOut ? "DOL didn't answer in time." : "DOL couldn't be reached." }, { status: 504, headers: { "Cache-Control": "no-store" } });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The same levels from our stored copy of DOL's published wage file, or null when it holds none or can't be read (the
 * caller then answers with DOL's own failure, so nothing reads as "no wage").
 */
async function fromFile(soc: string, area: string, year: number): Promise<NextResponse | null> {
  const levels = await storedWageLevels(soc, area, year).catch((e: unknown) => {
    console.error("[wage-levels] the stored wage file couldn't be read either", { soc: socGroup(soc), area, error: String(e) });
    return null;
  });
  if (!levels) return null;
  return NextResponse.json(
    { ok: true, soc: socGroup(soc), area: Number(area), seriesYear: year, levels, source: WAGE_DOWNLOADS_PAGE, from: "file" },
    { headers: { "Cache-Control": "public, max-age=600, s-maxage=3600" } },
  );
}
