import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_PLANS } from "@convex/lib/apiPlans";

/**
 * GET /v1/cases: a case found without its number. The route hands its seven parameters to the one
 * read the MCP tool and the chat use, counts an answer, and a sandbox key gets the fixed sample.
 */
const authenticate = vi.fn();
const takeMinute = vi.fn();
const checkAllowance = vi.fn();
const countCall = vi.fn();
const findCases = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (...a: unknown[]) => authenticate(...a) }));
vi.mock("@/lib/api/usage", () => ({
  takeMinute: (...a: unknown[]) => takeMinute(...a),
  checkAllowance: (...a: unknown[]) => checkAllowance(...a),
  countCall: (...a: unknown[]) => countCall(...a),
}));
vi.mock("@/lib/api/reads", () => ({ findCases: (...a: unknown[]) => findCases(...a) }));

import { GET } from "../route";

const caller = (over: Record<string, unknown> = {}) => ({
  kind: "key" as const,
  keyId: "KEY00001",
  account: "acct_a",
  plan: API_PLANS.plus,
  accountPlan: "free" as const,
  paywall: false,
  scopes: ["read"],
  sandbox: false,
  expiresAt: null,
  ...over,
});
const meta = { source: "DOL", asOf: "2026-11-09", url: "https://permtracker.app/perm-queue/2026-01/30" };
const call = (qs: string) =>
  GET(new Request(`https://permtracker.app/v1/cases${qs}`, { headers: { authorization: "Bearer x" } }), { params: Promise.resolve({}) });

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue({ ok: true, caller: caller() });
  takeMinute.mockReset().mockReturnValue({ ok: true, remaining: 100, reset: 30 });
  checkAllowance.mockReset().mockResolvedValue({ ok: true, today: 0, month: 0 });
  countCall.mockReset();
  findCases.mockReset().mockResolvedValue({ ok: true, data: { matched: 1, cases: [{ caseNumber: "G-100-26030-000001" }] }, meta });
});

describe("GET /v1/cases", () => {
  it("hands the employer, the day, the kind and the job to the read, and answers with its source and page", async () => {
    const res = await call("?employer=Acme%20Robotics&filed=2026-01-30&program=pwd&job=controls");
    expect(res.status).toBe(200);
    expect(findCases).toHaveBeenCalledExactlyOnceWith({ employer: "Acme Robotics", filed: "2026-01-30", from: null, to: null, program: "pwd", job: "controls", firm: null });
    expect(await res.json()).toEqual({ data: { matched: 1, cases: [{ caseNumber: "G-100-26030-000001" }] }, meta });
    expect(countCall).toHaveBeenCalledTimes(1);
  });

  it("hands a range of days and a law firm on too, with no employer", async () => {
    await call("?job=controls%20engineer&firm=Smith%20Immigration&from=2026-01-05&to=2026-02-28");
    expect(findCases).toHaveBeenCalledExactlyOnceWith({ employer: null, filed: null, from: "2026-01-05", to: "2026-02-28", program: null, job: "controls engineer", firm: "Smith Immigration" });
  });

  it("passes what's missing as missing, so the read says which parameter it needs", async () => {
    findCases.mockResolvedValue({ ok: false, status: 400, code: "bad_request", message: "filed must be the filing day, like 2026-01-30." });
    const res = await call("?employer=Acme");
    expect(findCases).toHaveBeenCalledWith({ employer: "Acme", filed: null, from: null, to: null, program: null, job: null, firm: null });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("filed must be the filing day");
    // A refusal isn't an answer: nothing is counted against the caller.
    expect(countCall).not.toHaveBeenCalled();
  });

  it("answers an error, never an empty list, when the day can't be read", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    findCases.mockRejectedValue(new Error("fetch failed"));
    const res = await call("?employer=Acme&filed=2026-01-30");
    expect(res.status).toBe(500);
    expect(countCall).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("gives a sandbox key the fixed sample without reading or counting", async () => {
    authenticate.mockResolvedValue({ ok: true, caller: caller({ sandbox: true }) });
    const res = await call("?employer=Example&filed=2026-02-10");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ filed: "2026-02-10", matched: 1, cases: [{ caseNumber: "G-100-26000-000101", employer: "Example Robotics LLC" }] });
    expect(body.meta.source).toContain("sandbox");
    expect(findCases).not.toHaveBeenCalled();
  });
});
