import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The page-context tool reads the case the person is looking at. A read that fails is said to the model, so it
 * never tells the person it can't see the case, or answers about it from nothing.
 */
vi.mock("server-only", () => ({}));
const fetchQuery = vi.fn();
vi.mock("convex/nextjs", () => ({ fetchQuery: (...a: unknown[]) => fetchQuery(...a), fetchAction: vi.fn(), fetchMutation: vi.fn() }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

const { createTools } = await import("../create-tools");

const CASE_ID = "k577zsgc2hqkypgjp070hhnh458g4dyg";
const pageContext = { path: `/cases/${CASE_ID}`, pageType: "case-detail", timestamp: 1, currentCaseId: CASE_ID };

type Exec = (input: { includeVisibleCaseData?: boolean }, options: object) => Promise<Record<string, unknown>>;
const run = (input: { includeVisibleCaseData?: boolean }) => {
  const tools = createTools("token", null, undefined, "confirm", pageContext as never);
  return (tools.getPageContext as unknown as { execute: Exec }).execute(input, {}).then((r) => r.pageContext as Record<string, unknown>);
};

beforeEach(() => {
  fetchQuery.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getPageContext", () => {
  it("hands over the case on screen when it reads", async () => {
    fetchQuery.mockResolvedValue({ _id: CASE_ID, employerName: "Acme Corp" });
    const out = await run({ includeVisibleCaseData: true });
    expect(out.currentCaseData).toMatchObject({ employerName: "Acme Corp" });
    expect(out.currentCaseDataError).toBeUndefined();
  });

  it("says the case couldn't be read when the read fails", async () => {
    fetchQuery.mockRejectedValue(new Error("fetch failed"));
    const out = await run({ includeVisibleCaseData: true });
    expect(out.currentCaseData).toBeUndefined();
    expect(String(out.currentCaseDataError)).toMatch(/couldn't be read just now/);
    expect(out.currentCaseId).toBe(CASE_ID);
  });
});
