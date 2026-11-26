/** The agents' search: Markdown with pages, employers, firms and articles that match, a cap before any matching. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchNameOrLetters = vi.fn();
vi.mock("@/lib/db/entities", () => ({ searchNameOrLetters }));
vi.mock("@/lib/content", () => ({
  getAllPosts: () => [
    { type: "guides", slug: "eta-9089-expiration-and-i140-deadline", meta: { title: "ETA 9089 expiration date and the I-140 deadline" } },
    { type: "blog", slug: "what-is-perm-labor-certification", meta: { title: "What is PERM labor certification" } },
  ],
}));

const { GET } = await import("../route");
const get = (q: string | null) => GET(new Request(`https://permtracker.app/.well-known/search${q === null ? "" : `?q=${encodeURIComponent(q)}`}`));

beforeEach(() => {
  searchNameOrLetters.mockReset();
  searchNameOrLetters.mockImplementation(async (kind: string) =>
    kind === "employer" ? [{ slug: "microsoft-corporation", name: "Microsoft Corporation", total: 1234, certified: 1200 }] : [],
  );
});

describe("GET /.well-known/search", () => {
  it("answers in Markdown with each kind's matches and their addresses", async () => {
    const res = await get("i140 deadline");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const text = await res.text();
    expect(text).toContain('# Search results for: "i140 deadline"');
    expect(text).toContain("[ETA 9089 expiration date and the I-140 deadline](https://permtracker.app/guides/eta-9089-expiration-and-i140-deadline)");
    expect(text).toContain("[Microsoft Corporation](https://permtracker.app/perm-employers/microsoft-corporation): 1,234 decided, 1,200 certified");
  });

  it("asks for words when there are none, and refuses a long query before matching anything", async () => {
    expect((await get(null)).status).toBe(400);
    expect((await get("   ")).status).toBe(400);
    expect((await get("x".repeat(5000))).status).toBe(400);
    expect(searchNameOrLetters).not.toHaveBeenCalled();
  });

  it("still answers with pages and articles when the names can't be read", async () => {
    searchNameOrLetters.mockRejectedValue(new Error("db down"));
    const res = await get("what is perm");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("What is PERM labor certification");
  });
});
