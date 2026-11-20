import { beforeEach, describe, expect, it, vi } from "vitest";

const warnForSlug = vi.fn();
vi.mock("@/lib/db/warn", () => ({ warnForSlug: (...a: unknown[]) => warnForSlug(...a) }));

import { GET } from "../route";

const notice = (id: string, noticeDate: string) => ({
  id,
  state: "CA",
  noticeDate,
  effectiveDate: null,
  company: "Acme Corp",
  kind: "Layoff",
  employees: 60,
  county: "Santa Clara",
  industry: null,
  employerSlug: "acme-corp",
  sourceUrl: "https://edd.ca.gov/warn",
  site: null,
});
const get = (q: string) => GET(new Request(`https://permtracker.app/api/warn-notices?${q}`));

describe("an employer's WARN notices in a window", () => {
  beforeEach(() => {
    warnForSlug.mockReset();
  });

  it("answers the employer's notices dated in the window, a month-only one included", async () => {
    warnForSlug.mockResolvedValue([notice("a", "2026-12-01"), notice("b", "2026-08-01"), notice("c", "2026-05"), notice("d", "2026-01-02")]);
    const r = await get("slug=acme-corp&from=2026-05-20&to=2026-11-20");
    expect(r.status).toBe(200);
    expect(((await r.json()) as { notices: { id: string }[] }).notices.map((n) => n.id)).toEqual(["b", "c"]);
    expect(warnForSlug).toHaveBeenCalledWith("acme-corp", 200);
  });

  it("refuses anything but an employer page's slug and two days in order", async () => {
    for (const q of ["slug=Acme Corp&from=2026-05-20&to=2026-11-20", "slug=acme-corp&from=May&to=2026-11-20", "slug=acme-corp&from=2026-11-20&to=2026-05-20", "from=2026-05-20&to=2026-11-20"]) {
      expect((await get(q)).status, q).toBe(400);
    }
    expect(warnForSlug).not.toHaveBeenCalled();
  });

  it("says a failed read failed, never that there were no notices", async () => {
    warnForSlug.mockImplementation(async () => {
      throw new Error("database down");
    });
    const r = await get("slug=acme-corp&from=2026-05-20&to=2026-11-20");
    expect(r.status).toBe(503);
    expect(await r.json()).not.toHaveProperty("notices");
  });
});
