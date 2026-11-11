import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The refresh route for the shared timelines: shut without the secret; the board's fixed pages on every valid
 * call; an office's own page only for a code the site's list holds; and a list of board pages that can't drift
 * from the pages that read the board (a page left off would keep an approved timeline out of its medians, or a
 * declined one in them, until the page's own window ended).
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const { POST } = await import("../route");
const { TIMELINE_PAGES, MAX_OFFICES } = await import("../paths");

const SECRET = "test-secret-value";
const post = (body: unknown, secret: string | null = SECRET) =>
  new Request("https://permtracker.app/api/revalidate-timelines", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "x-revalidate-secret": secret }) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  revalidatePath.mockReset();
  process.env.REVALIDATE_SECRET = SECRET;
});

describe("POST /api/revalidate-timelines", () => {
  it("refuses no secret, a wrong secret, and an unconfigured one", async () => {
    expect((await POST(post({ offices: [] }, null))).status).toBe(403);
    expect((await POST(post({ offices: [] }, "wrong"))).status).toBe(403);
    delete process.env.REVALIDATE_SECRET;
    expect((await POST(post({ offices: [] }, null))).status).toBe(403);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refreshes the board's pages, and the page of each office named by USCIS's code", async () => {
    const res = await POST(post({ offices: ["HAR", "HAR", "BOS"] }));
    expect(res.status).toBe(200);
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      ...TIMELINE_PAGES,
      "/i485-by-field-office/hartford-connecticut",
      "/i485-by-field-office/boston-massachusetts",
    ]);
  });

  it("refreshes the board alone when no office is named, or the body is empty", async () => {
    expect((await POST(post({}))).status).toBe(200);
    expect((await POST(post(""))).status).toBe(200);
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([...TIMELINE_PAGES, ...TIMELINE_PAGES]);
  });

  it("skips a code the office list doesn't hold, names it, and can't be aimed at another page", async () => {
    const res = await POST(post({ offices: ["ZZZ", "../admin"] }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { unknown: string[] }).unknown).toEqual(["ZZZ", "../admin"]);
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([...TIMELINE_PAGES]);
  });

  it.each([
    ["offices that aren't a list", { offices: "HAR" }],
    ["a code that isn't a string", { offices: [7] }],
    ["a code too long to be one", { offices: ["x".repeat(50)] }],
    ["more offices than one decision can touch", { offices: Array.from({ length: MAX_OFFICES + 1 }, () => "HAR") }],
  ])("answers 400 to %s and refreshes nothing", async (_, body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("the path list", () => {
  it("names every public page that reads the board", () => {
    const appDir = join(process.cwd(), "src/app");
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === "page.tsx" && readFileSync(full, "utf8").includes("api.communityTimelines.board")) pages.push(full);
      }
    };
    walk(appDir);
    const routes = pages
      .map((f) => "/" + relative(appDir, f).replace(/\/?page\.tsx$/, "").split("/").filter((s) => !s.startsWith("(")).join("/"))
      .sort();
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).toEqual([...TIMELINE_PAGES].sort());
  });
});
