import { readConsulates } from "@/lib/api/figureReads";
import { apiGet } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** Every consulate's immigrant visa interview line and its issuances in the newest 12 months. */
export const GET = apiGet(async () => readConsulates());
