import { describe, expect, it } from "vitest";

import { GET } from "../route";

describe("GET /.well-known/api-catalog", () => {
  it("is a linkset that points at the API's description, docs, health check and terms", async () => {
    // Act
    const res = GET();
    const body = (await res.json()) as { linkset: Record<string, unknown>[] };
    // Assert
    expect(res.headers.get("Content-Type")).toContain("application/linkset+json");
    expect(res.headers.get("Content-Type")).toContain("rfc9727");
    const api = body.linkset.find((l) => l.anchor === "https://permtracker.app/v1") as Record<string, { href: string }[]>;
    expect(api["service-desc"]![0]!.href).toBe("https://permtracker.app/v1/openapi.json");
    expect(api["service-doc"]![0]!.href).toBe("https://permtracker.app/developers");
    expect(api.status![0]!.href).toBe("https://permtracker.app/v1/health");
    expect(api["terms-of-service"]![0]!.href).toBe("https://permtracker.app/api-terms");
  });

  it("names the assistant server too", async () => {
    const body = (await GET().json()) as { linkset: { anchor: string }[] };
    expect(body.linkset.map((l) => l.anchor)).toContain("https://permtracker.app/mcp");
  });
});
