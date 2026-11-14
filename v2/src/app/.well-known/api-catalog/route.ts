import { API_BASE, DEVELOPERS_URL, MCP_URL } from "@/lib/api/addresses";

export const dynamic = "force-static";

/**
 * /.well-known/api-catalog (RFC 9727): where a program that has only the site's name finds its API. One entry,
 * the /v1 API, with links to its OpenAPI document, its docs, its health check and its terms, and a second entry
 * for the assistant server.
 */
export function GET(): Response {
  const linkset = {
    linkset: [
      {
        anchor: API_BASE,
        "service-desc": [{ href: `${API_BASE}/openapi.json`, type: "application/json", title: "OpenAPI 3.1 description" }],
        "service-doc": [{ href: DEVELOPERS_URL, type: "text/html", title: "Developer page" }],
        status: [{ href: `${API_BASE}/health`, type: "application/json" }],
        "terms-of-service": [{ href: "https://permtracker.app/api-terms", type: "text/html" }],
      },
      {
        anchor: MCP_URL,
        "service-doc": [{ href: `${DEVELOPERS_URL}#assistants`, type: "text/html", title: "Model Context Protocol server: the same reads as assistant tools" }],
      },
    ],
  };
  return new Response(JSON.stringify(linkset), {
    headers: {
      "Content-Type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
