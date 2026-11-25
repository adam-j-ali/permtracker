import { readUscisI140 } from "@/lib/api/figureReads";
import { apiGet } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** USCIS's own I-140 figures: the quarter by subtype, recent quarters, processing times and petitions awaiting a visa. */
export const GET = apiGet(async () => readUscisI140());
