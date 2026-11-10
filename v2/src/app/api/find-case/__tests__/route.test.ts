import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The finder's route: it cuts and checks what was typed before anything reads, hands the ask to the one function
 * every surface shares, and turns that function's three endings into three statuses: an answer (200), a refusal
 * with its sentence (400), a failed read (503, never an empty list).
 */
const findCase = vi.fn();
vi.mock("@/lib/findCase", () => ({ findCase: (...a: unknown[]) => findCase(...a) }));
vi.mock("@convex/lib/time", () => ({ easternDay: () => "2026-11-10" }));

const { GET } = await import("../route");

const get = (query: string) => GET(new Request(`https://permtracker.app/api/find-case?${query}`));
const answer = { program: "perm", asked: { employer: "", title: "", firm: "" }, by: "window", window: { from: "2026-01-05", to: "2026-01-05", assumed: false }, cases: [], matched: 0, ofEmployer: null, capped: false, period: null, close: [], firm: null, firmUnknown: false, decidedOnly: false };

beforeEach(() => {
  findCase.mockReset();
  findCase.mockResolvedValue({ ok: true, answer });
});

describe("GET /api/find-case", () => {
  it("hands the ask on, trimmed, with PERM as the program when none is named", async () => {
    const res = await get("employer=%20Acme%20&title=engineer&firm=smith&from=2026-01-05&to=2026-01-31");
    expect(res.status).toBe(200);
    expect(findCase).toHaveBeenCalledWith("perm", { employer: "Acme", title: "engineer", firm: "smith", from: "2026-01-05", to: "2026-01-31" }, "2026-11-10");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=900");
  });

  it("leaves empty fields out of the answer", async () => {
    const body = await (await get("program=lca&from=2026-01-05")).json();
    expect(findCase.mock.calls[0]![0]).toBe("lca");
    expect(body).toMatchObject({ by: "window", matched: 0, capped: false });
    expect("period" in body).toBe(false);
    expect("firm" in body).toBe(false);
  });

  it("refuses an unknown program and an over-long box before any read", async () => {
    expect((await get("program=h1b&employer=acme")).status).toBe(400);
    expect((await get(`employer=${"a".repeat(121)}`)).status).toBe(400);
    expect((await get(`title=${"a".repeat(81)}`)).status).toBe(400);
    expect((await get(`firm=${"a".repeat(121)}`)).status).toBe(400);
    expect(findCase).not.toHaveBeenCalled();
  });

  it("answers a refusal with its own sentence and the reason", async () => {
    findCase.mockResolvedValue({ ok: false, why: "too-long", message: "Pick dates three months apart or less, or add the employer's name or the law firm." });
    const res = await get("title=engineer&from=2026-01-01&to=2026-08-01");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pick dates three months apart or less, or add the employer's name or the law firm.", why: "too-long" });
  });

  it("answers a failed read with 503, never an empty list, and isn't kept", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    findCase.mockRejectedValue(new Error("database is locked"));
    const res = await get("employer=acme&from=2026-01-05");
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).error).toMatch(/couldn't be read/);
    err.mockRestore();
  });
});
