import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConsulates, resetConsulateList } from "../consulateList";

const list = [{ label: "Mumbai: immigrant visas", href: "/consular-posts/mumbai", keywords: "mumbai consulate embassy" }];

afterEach(() => {
  resetConsulateList();
  vi.unstubAllGlobals();
});

describe("the consulate list for search", () => {
  it("is fetched once from /consulates.json however many ask", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(list)));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([loadConsulates(), loadConsulates()]);
    expect(a).toEqual(list);
    expect(b).toEqual(list);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/consulates.json");
  });

  it("refuses a failed answer, and tries again next time", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(list)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadConsulates()).rejects.toThrow("503");
    expect(await loadConsulates()).toEqual(list);
  });
});
