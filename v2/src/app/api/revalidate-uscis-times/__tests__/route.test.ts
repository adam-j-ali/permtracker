import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The guards on the USCIS posted-times refresh, and its list held to the pages that read the posted figures. */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath, revalidateTag: vi.fn() }));

const { POST } = await import("../route");
const { USCIS_TIMES_PAGES, USCIS_TIMES_PAGE_FAMILIES } = await import("../paths");

const SECRET = "test-secret-value";
const appDir = join(process.cwd(), "src", "app");

const post = (secret: string | null = SECRET) =>
  new Request("https://permtracker.app/api/revalidate-uscis-times", {
    method: "POST",
    headers: secret === null ? {} : { "x-revalidate-secret": secret },
  });

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === "page.tsx") out.push(p);
  }
  return out;
}
const routeOf = (file: string) =>
  "/" + file.slice(appDir.length + 1).replace(/\/page\.tsx$/, "").replace(/\([^)]*\)\/?/g, "").replace(/^\/+|\/+$/g, "");

beforeEach(() => {
  revalidatePath.mockReset();
  process.env.REVALIDATE_SECRET = SECRET;
});

describe("POST /api/revalidate-uscis-times", () => {
  it("refuses no secret, a wrong secret, and an unconfigured secret", async () => {
    expect((await POST(post(null))).status).toBe(403);
    expect((await POST(post("wrong"))).status).toBe(403);
    delete process.env.REVALIDATE_SECRET;
    expect((await POST(post(null))).status).toBe(403);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("expires every listed page, and every family as pages", async () => {
    expect((await POST(post())).status).toBe(200);
    for (const p of USCIS_TIMES_PAGES) expect(revalidatePath).toHaveBeenCalledWith(p);
    for (const f of USCIS_TIMES_PAGE_FAMILIES) expect(revalidatePath).toHaveBeenCalledWith(f, "page");
    expect(revalidatePath).toHaveBeenCalledTimes(USCIS_TIMES_PAGES.length + USCIS_TIMES_PAGE_FAMILIES.length);
  });

  it("each family is the file path of a real page, route groups included", () => {
    for (const f of USCIS_TIMES_PAGE_FAMILIES) {
      expect(statSync(join(appDir, f, "page.tsx")).isFile()).toBe(true);
      expect(f).toMatch(/\[[a-z]+\]/);
    }
  });

  it("lists every page that reads the posted figures, and nothing else", () => {
    const readers = walk(appDir)
      .filter((f) => /from "@\/lib\/db\/uscisPosted"/.test(readFileSync(f, "utf8")))
      .map(routeOf)
      .sort();
    expect(readers.length).toBeGreaterThan(0);
    const urlOf = (family: string) => family.replace(/\([^)]*\)\/?/g, "").replace(/\/+/g, "/");
    expect([...USCIS_TIMES_PAGES, ...USCIS_TIMES_PAGE_FAMILIES.map(urlOf)].sort()).toEqual(readers);
  });
});
