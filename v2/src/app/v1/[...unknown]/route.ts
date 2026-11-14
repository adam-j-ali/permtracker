import { API_BASE } from "@/lib/api/addresses";
import { apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/**
 * Any /v1 address that isn't an endpoint. Answered as JSON like every other refusal, never with the site's HTML
 * "page not found", which a program calling an API can't read. No key is checked and nothing is counted.
 */
function unknownEndpoint(): Response {
  return apiError(404, "unknown_endpoint", `There's no endpoint at this address. The list is at ${API_BASE}.`, { url: API_BASE });
}

export { unknownEndpoint as GET, unknownEndpoint as POST, unknownEndpoint as PUT, unknownEndpoint as PATCH, unknownEndpoint as DELETE };
