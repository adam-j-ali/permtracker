import { readConsulate } from "@/lib/api/figureReads";
import { apiGet } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** One consulate's interview line over time and its issuances each month. */
export const GET = apiGet<{ slug: string }>(async (_ctx, { slug }) => readConsulate(slug));
