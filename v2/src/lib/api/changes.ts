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
