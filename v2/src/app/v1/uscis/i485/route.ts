import { readUscisI485 } from "@/lib/api/figureReads";
import { apiGet } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** USCIS's own I-485 figures: the quarter by office, the employment-based inventory and processing times. */
export const GET = apiGet(async () => readUscisI485());
