import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Convex's DOL refresh reads the snapshot the server's ingest stored (Nov 25 2026) instead of fetching DOL's page a
 * second time: the same parser wrote it, so the stored row and a fresh parse are one snapshot.
 */
const query = vi.fn();
vi.mock("../lib/publicMirror", () => ({ query, rows: vi.fn(), one: vi.fn() }));

const { createTestContext } = await import("../../test-utils/convex");
const { internal } = await import("../_generated/api");
const { parseProcessingTimes } = await import("../lib/dolProcessingTimes");

const PAGE = readFileSync(join(__dirname, "../lib/__fixtures__/flag-processingtimes-2026-11-02.html"), "utf8");

afterEach(() => {
  query.mockReset();
  vi.unstubAllGlobals();
});

describe("dolProcessingTimes.refresh", () => {
  it("stores the snapshot the ingest saved, without fetching DOL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const snapshot = parseProcessingTimes(PAGE);
    query.mockResolvedValue([[{ json: JSON.stringify(snapshot) }]]);
    const t = createTestContext();
    const got = await t.action(internal.dolProcessingTimes.refresh, {});
    expect(got).toMatchObject({ stored: true, permAsOf: snapshot.permAsOf });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(String(query.mock.calls[0]?.[0]?.[0]?.sql)).toContain("FROM processing_times");
    // The same row again changes nothing.
    expect(await t.action(internal.dolProcessingTimes.refresh, {})).toMatchObject({ stored: false });
  });

  it("refuses an empty or broken row rather than storing a month where nothing moved", async () => {
    query.mockResolvedValue([[]]);
    const t = createTestContext();
    await expect(t.action(internal.dolProcessingTimes.refresh, {})).rejects.toThrow(/no stored snapshot/);
    query.mockResolvedValue([[{ json: '{"permAsOf":"2026-11-02"}' }]]);
    await expect(t.action(internal.dolProcessingTimes.refresh, {})).rejects.toThrow(/permQueues/);
  });
});
