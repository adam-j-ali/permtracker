import { describe, expect, it } from "vitest";

import { API_VERSION } from "@/lib/api/openapi";
import { HealthSchema } from "@/lib/api/schemas";

import { GET } from "../route";

describe("GET /v1/health", () => {
  it("answers ok with no key, in the documented shape", async () => {
    // Act
    const res = GET();
    const body = (await res.json()) as Record<string, unknown>;
    // Assert
    expect(res.status).toBe(200);
    expect(HealthSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ status: "ok", version: API_VERSION, openapi: "https://permtracker.app/v1/openapi.json" });
  });

  it("can be read from a browser on any site, and stays out of search", () => {
    const res = GET();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});
