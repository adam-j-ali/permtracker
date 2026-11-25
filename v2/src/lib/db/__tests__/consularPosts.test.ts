import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
vi.mock("../client", () => ({ rows, one, exec: vi.fn() }));

const { getConsularIndex } = await import("../consularPosts");

const TOOL = ["employment", "family", "immediate"].map((category) => ({
  post_key: "mumbai",
  post: "Mumbai",
  category,
  printed: "June 2025",
  month: "2025-06",
}));

function route(issued: unknown[]) {
  rows.mockImplementation(async (sql) => {
    if (sql.startsWith("SELECT DISTINCT as_of")) return [{ as_of: "2026-11-20" }];
    if (sql.includes("FROM iv_scheduling WHERE as_of")) return TOOL;
    if (sql.includes("FROM visa_issuances")) return issued;
    return [];
  });
}

describe("the consular index's visas issued", () => {
  beforeEach(() => {
    rows.mockReset();
    one.mockReset();
  });

  it("counts each post's visas when State's tables are read", async () => {
    one.mockResolvedValue({ json: JSON.stringify({ months: ["2025-03", "2026-02"], newest: "2026-02", byMonth: {} }) });
    route([{ group_key: "mumbai", label: "Mumbai", newest: "2026-02", n: "1200", eb: "300" }]);
    const got = await getConsularIndex();
    expect(got.issuedTo).toBe("2026-02");
    expect(got.posts.find((p) => p.key === "mumbai")).toMatchObject({ issued: 1200, employment: 300 });
  });

  it("knows nothing about visas issued when State's tables couldn't be read, so no page prints 0 (Nov 25 2026)", async () => {
    one.mockRejectedValue(new Error("database unreachable"));
    route([]);
    const got = await getConsularIndex();
    expect(got.issuedTo).toBeNull();
    expect(got.posts.find((p) => p.key === "mumbai")).toMatchObject({ issued: null, employment: null });
  });
});
