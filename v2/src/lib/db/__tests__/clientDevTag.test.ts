import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A development server's statements reach the live database through the
 * tunnel, and sqld's per-statement stats can't say who sent one. The server's
 * hourly reading (scripts/oracle/bin/permtracker-perf) read a page check run
 * against the live data on Nov 15 2026 as the live site's slow statements, and
 * the morning report warned. Each statement a development server sends now
 * starts with a comment sqld keeps in its stats (checked on the server, Nov 16
 * 2026) and SQLite ignores; the reading names those instead of warning.
 */

vi.mock("server-only", () => ({}));

const execute = vi.fn();
vi.mock("@libsql/client/http", () => ({
  createClient: () => ({ execute }),
}));

const OK = { rows: [{ n: 1 }], columns: ["n"], rowsAffected: 1 };

beforeEach(() => {
  vi.resetModules();
  execute.mockReset();
  execute.mockResolvedValue(OK);
  process.env.DATABASE_URL = "libsql://test";
  process.env.DATABASE_AUTH_TOKEN = "t";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the development tag on a statement", () => {
  it("leads every read a development server sends", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { rows, DEV_STATEMENT_TAG } = await import("../client");
    await rows("SELECT 1 AS n");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].sql).toBe(`${DEV_STATEMENT_TAG}SELECT 1 AS n`);
    expect(DEV_STATEMENT_TAG.startsWith("/*")).toBe(true);
  });

  it("leads a development server's writes too", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { exec, DEV_STATEMENT_TAG } = await import("../client");
    await exec("INSERT INTO t (a) VALUES (?)", [1]);
    expect(execute.mock.calls[0][0].sql).toBe(`${DEV_STATEMENT_TAG}INSERT INTO t (a) VALUES (?)`);
  });

  it("never reaches the live site's statements", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { rows } = await import("../client");
    await rows("SELECT 1 AS n");
    expect(execute.mock.calls[0][0].sql).toBe("SELECT 1 AS n");
  });

  it("stays out of the tests' statements", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { rows } = await import("../client");
    await rows("SELECT 1 AS n");
    expect(execute.mock.calls[0][0].sql).toBe("SELECT 1 AS n");
  });
});
