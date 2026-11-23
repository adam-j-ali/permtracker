import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A page draws its state map only when the builders' markers say the state facets hold every state: until the first
 * build that keeps them all, a facet holds the busiest six and the map would show the rest as zeros.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }));

const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
vi.mock("../client", () => ({ rows, one: vi.fn() }));

const { stateFacetCoverage, STATE_FACET_DOCS } = await import("../entityDetail");

beforeEach(() => {
  rows.mockReset();
});

describe("stateFacetCoverage", () => {
  it("reads both builders' markers in one point read", async () => {
    rows.mockResolvedValue([]);
    await stateFacetCoverage();
    expect(rows).toHaveBeenCalledTimes(1);
    const [sql, args] = rows.mock.calls[0]!;
    expect(sql).toMatch(/FROM perm_docs WHERE key IN \(\?, \?\)/);
    // The names the Python builders write (build_entity_detail.FACETS_DOC, ingest_perm_history.HISTORY_FACETS_DOC).
    expect(args).toEqual(["entity_facets", "history_entity_facets"]);
    expect(STATE_FACET_DOCS).toEqual({ current: "entity_facets", history: "history_entity_facets" });
  });

  it("says every state is held only where a marker says so", async () => {
    rows.mockResolvedValue([{ key: "entity_facets", json: '{"states":"all","stateRows":56}' }]);
    expect(await stateFacetCoverage()).toEqual({ current: true, history: false });
    rows.mockResolvedValue([
      { key: "entity_facets", json: '{"states":"all"}' },
      { key: "history_entity_facets", json: '{"states":"all"}' },
    ]);
    expect(await stateFacetCoverage()).toEqual({ current: true, history: true });
  });

  it("reads a missing, broken or different marker as not yet", async () => {
    rows.mockResolvedValue([]);
    expect(await stateFacetCoverage()).toEqual({ current: false, history: false });
    rows.mockResolvedValue([
      { key: "entity_facets", json: "{not json" },
      { key: "history_entity_facets", json: '{"states":"top6"}' },
    ]);
    expect(await stateFacetCoverage()).toEqual({ current: false, history: false });
  });

  it("throws on a failed read, for the page to name and draw no map", async () => {
    rows.mockRejectedValue(new Error("db down"));
    await expect(stateFacetCoverage()).rejects.toThrow("db down");
  });

  it("names the keys the builders write", async () => {
    const { readFileSync } = await import("node:fs");
    const current = readFileSync("scripts/build_entity_detail.py", "utf8");
    const history = readFileSync("scripts/ingest_perm_history.py", "utf8");
    expect(current).toContain(`FACETS_DOC = "${STATE_FACET_DOCS.current}"`);
    expect(history).toContain(`HISTORY_FACETS_DOC = "${STATE_FACET_DOCS.history}"`);
  });
});
