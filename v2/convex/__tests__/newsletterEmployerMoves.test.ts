import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The digest's read of the employer census. A missing or stale doc leaves the block out; a read that fails
 * fails the issue (buildIssue records it), so a week whose only news was an employer move isn't judged empty.
 */

const one = vi.fn();
vi.mock("../lib/publicMirror", () => ({ rows: vi.fn(), one }));

const { readEmployerMoves } = await import("../newsletter");

beforeEach(() => {
  one.mockReset();
});

describe("readEmployerMoves", () => {
  it("leaves the block out when the census doc is missing or stale", async () => {
    one.mockResolvedValue(null);
    expect(await readEmployerMoves("2026-11-09")).toEqual([]);
    one.mockResolvedValue({ json: "{}", computed_at: 0 });
    expect(await readEmployerMoves("2026-11-09")).toEqual([]);
  });

  it("fails when the mirror can't be read, never answering that no employer moved", async () => {
    one.mockRejectedValue(new Error("libsql HTTP 502 Bad Gateway"));
    await expect(readEmployerMoves("2026-11-09")).rejects.toThrow(/502/);
  });
});
