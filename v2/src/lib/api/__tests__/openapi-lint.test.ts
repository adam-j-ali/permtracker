/**
 * The OpenAPI document, read by a linter that isn't ours.
 *
 * The other spec tests check what we thought to check. This runs Redocly's own rules over the generated document
 * (the recommended set, with the ones about names, descriptions and examples raised to errors), so a fault a
 * directory or a code generator would trip over shows here first. An outside directory's scorecard is what
 * showed the first version had no operationId, no tags and no examples.
 */
import { createConfig, lintFromString } from "@redocly/openapi-core";
import { describe, expect, it } from "vitest";

import { openApiDocument } from "../openapi";

const RULES = {
  "operation-operationId": "error",
  "operation-operationId-unique": "error",
  "operation-operationId-url-safe": "error",
  "operation-summary": "error",
  "operation-description": "error",
  "operation-tag-defined": "error",
  "tag-description": "error",
  "info-license": "error",
  "parameter-description": "error",
  "path-parameters-defined": "error",
  "operation-parameters-unique": "error",
  "operation-2xx-response": "error",
  "operation-4xx-response": "error",
  "security-defined": "error",
  "no-unused-components": "error",
  "no-invalid-media-type-examples": "error",
  "no-invalid-parameter-examples": "error",
  "no-invalid-schema-examples": "error",
  "no-ambiguous-paths": "error",
  "no-identical-paths": "error",
  "no-path-trailing-slash": "error",
  "no-server-example.com": "error",
  "no-server-trailing-slash": "error",
  "no-unresolved-refs": "error",
  "spec-components-invalid-map-name": "error",
} as const;

async function problemsIn(doc: unknown): Promise<string[]> {
  const config = await createConfig({ extends: ["recommended"], rules: RULES });
  const problems = await lintFromString({ source: JSON.stringify(doc), absoluteRef: "openapi.json", config });
  return problems.map((p) => `${p.severity} ${p.ruleId}: ${p.message} at ${p.location[0]?.pointer ?? ""}`);
}

describe("the OpenAPI document under an outside linter", () => {
  it("has no error and no warning", async () => {
    expect(await problemsIn(openApiDocument())).toEqual([]);
  }, 60_000);

  it("is flagged when it's broken (control): an operation with no id, an example that misses its schema", async () => {
    // Arrange: two faults of the kind the rules exist for.
    const doc = openApiDocument() as { paths: Record<string, Record<string, { operationId?: string; parameters: { example: unknown }[] }>> };
    delete doc.paths["/queue"]!.get!.operationId;
    doc.paths["/employers"]!.get!.parameters[1]!.example = "many";
    // Act
    const found = await problemsIn(doc);
    // Assert
    expect(found.some((p) => p.includes("operation-operationId"))).toBe(true);
    expect(found.some((p) => p.includes("no-invalid-parameter-examples"))).toBe(true);
  }, 60_000);
});
