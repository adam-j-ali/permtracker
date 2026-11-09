import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Is this your DOL case?" never answers for a withheld employer: its cases under the label would tie the real
 * name to it. Mocked at the mirror, so whether the read happens at all is what's tested.
 */

const rows = vi.fn();
vi.mock("../lib/publicMirror", () => ({ rows, one: vi.fn() }));

const { createTestContext, createAuthenticatedContext } = await import("../../test-utils/convex");
const { api } = await import("../_generated/api");

// Made up, like every name in the masker's tests.
const WITHHELD = "jane-q-example|Jane Q Example|Private household employer|G-100-25001-000001|1||";

beforeEach(() => {
  rows.mockReset();
  rows.mockResolvedValue([
    { case_number: "G-100-25001-000002", current_status: "Pending", employer_name: "Acme Corp", job_title: "Engineer", filing_date: "2025-01-02" },
  ]);
  vi.stubEnv("WITHHELD_EMPLOYERS", WITHHELD);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("suggestDolCase", () => {
  it("reads nothing and finds nothing for a withheld employer's name", async () => {
    const user = await createAuthenticatedContext(createTestContext());
    const got = await user.action(api.appCaseMatch.suggestDolCase, { employerName: "Jane Q Example", filingDate: "2025-01-02", program: "perm" });
    expect(got).toEqual({ candidates: [], likely: null });
    expect(rows).not.toHaveBeenCalled();
  });

  it("still suggests cases for any other employer", async () => {
    const user = await createAuthenticatedContext(createTestContext());
    const got = await user.action(api.appCaseMatch.suggestDolCase, { employerName: "Acme Corp", filingDate: "2025-01-02", program: "perm" });
    expect(rows).toHaveBeenCalledTimes(1);
    expect(got.candidates.map((c) => c.caseNumber)).toEqual(["G-100-25001-000002"]);
  });

  it("reads the cases filed nearest the date first, so the cut at 60 never drops a close one", async () => {
    const user = await createAuthenticatedContext(createTestContext());
    await user.action(api.appCaseMatch.suggestDolCase, { employerName: "Acme Corp", filingDate: "2025-01-02", program: "perm" });
    const [sql, args] = rows.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/ORDER BY abs\(julianday\(filing_date\) - julianday\(\?\)\)\s+LIMIT 60/);
    expect(args.at(-1)).toBe("2025-01-02");
  });

  it("fails when DOL's record can't be read, never answering that no case matches", async () => {
    rows.mockRejectedValue(new Error("libsql HTTP 502 Bad Gateway"));
    const user = await createAuthenticatedContext(createTestContext());
    await expect(
      user.action(api.appCaseMatch.suggestDolCase, { employerName: "Acme Corp", filingDate: "2025-01-02", program: "perm" }),
    ).rejects.toThrow(/couldn't read DOL's record/);
  });
});
