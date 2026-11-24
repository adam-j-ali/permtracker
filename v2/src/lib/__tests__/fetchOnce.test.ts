import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchOnce } from "../fetchOnce";

/** A file a page asks for the first time a reader needs it: once a visit, again after a failure, never a wrong shape. */
const isList = (v: unknown): v is number[] => Array.isArray(v);

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchOnce", () => {
  it("asks once however many times it's called", async () => {
    // Arrange
    const fetcher = vi.fn(async () => answer(200, [1, 2]));
    vi.stubGlobal("fetch", fetcher);
    const load = fetchOnce("/a.json", isList);
    // Act
    const [a, b] = await Promise.all([load(), load()]);
    const c = await load();
    // Assert
    expect(a).toEqual([1, 2]);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/a.json");
  });

  it("forgets a failed answer, so the next call asks again", async () => {
    // Arrange
    const fetcher = vi.fn().mockResolvedValueOnce(answer(503, {})).mockResolvedValueOnce(answer(200, [3]));
    vi.stubGlobal("fetch", fetcher);
    const load = fetchOnce("/b.json", isList);
    // Act and assert
    await expect(load()).rejects.toThrow("/b.json answered 503");
    await expect(load()).resolves.toEqual([3]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refuses an answer of the wrong shape, and asks again next time", async () => {
    // Arrange
    const fetcher = vi.fn().mockResolvedValueOnce(answer(200, { not: "a list" })).mockResolvedValueOnce(answer(200, [4]));
    vi.stubGlobal("fetch", fetcher);
    const load = fetchOnce("/c.json", isList);
    // Act and assert
    await expect(load()).rejects.toThrow("/c.json isn't the shape expected");
    await expect(load()).resolves.toEqual([4]);
  });
});
