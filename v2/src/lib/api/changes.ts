/**
 * What changed in the API and the assistant server, newest first. The developer page prints it, so a builder can
 * see what moved without reading a diff. Every entry is dated, and nothing here removes something version 1 sent.
 */
export interface ApiChange {
  version: string;
  /** The day it shipped, YYYY-MM-DD. */
  date: string;
  changes: readonly string[];
}

export const API_CHANGES: readonly ApiChange[] = [
  {
    version: "1.2.0",
    date: "2026-11-25",
    changes: [
      "USCIS's own figures: /uscis/i140 (the newest quarter by subtype, eight quarters by category, processing times, and approved petitions waiting for a visa number) and /uscis/i485 (the newest quarter by office, the pending employment-based inventory, and processing times).",
      "The sample of USCIS receipt numbers, as estimates with a 95% margin: /uscis/receipt-blocks gives the share approved in each block, /uscis/receipt-blocks/{block} every status group in one block, and /uscis/receipt-months the shares by receipt month. Counts and shares only: no receipt number is ever sent.",
      "Consulates: /consulates lists each one's immigrant visa interview line and its issuances in the newest 12 months, and /consulates/{slug} gives one's history and monthly issuances.",
      "The timelines people reported: /timelines, for everyone or for one USCIS office or consulate. Self-reported, counts and medians only.",
      "The estimates' own record: /accuracy.",
      "Each comes to assistants as a tool of the same name: get_receipt_blocks, get_receipt_block, get_receipt_months, get_uscis_petitions, get_uscis_adjustments, list_consulates, get_consulate, get_timelines and get_accuracy.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-11-14",
    changes: [
      "The OpenAPI document names every operation (operationId), groups them by tag, types every parameter with an example, and publishes each answer's schema with an example.",
      "Errors are RFC 9457 problem documents (application/problem+json) with type, title, status, detail and code. The error object version 1.0 sent is still inside, unchanged.",
      "The assistant server offers one tool per read operation, named after it: get_case, find_cases, estimate_decision, get_queue, get_visa_bulletin, search_employers, get_employer, search_law_firms, get_law_firm, search_occupations, get_occupation, lookup_employer and lookup_soc. Calls under the old names are still answered.",
      "Tools return typed output (structuredContent) beside the text, and each tool publishes the full shape of its answer.",
      "An address under /v1 that isn't an endpoint answers 404 as JSON (unknown_endpoint), where it used to get the site's HTML page.",
      "A caller asking too fast, or arriving while the server is full, gets the same error shape as every other refusal (rate_limited, unavailable). That reply used to carry `error` as a word.",
      "A new endpoint, /health, says the API is up. No key.",
      "The X-API-Key header is documented beside Authorization: Bearer.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-02",
    changes: ["The first version: cases, estimates, the queue, the visa bulletin, and employers, law firms and occupations, as JSON and as assistant tools."],
  },
];
