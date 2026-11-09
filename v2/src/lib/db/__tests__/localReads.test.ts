import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Reads from the database file itself (localReads.ts): the same rows and types the HTTP client gives, read-only,
 * a runaway read stopped at its deadline, and every other failure sent back to sqld by the read layer. Runs against
 * a real SQLite file in WAL mode, the way sqld keeps the production one. This file runs in the isolated project.
 */

vi.mock("server-only", () => ({}));

const execute = vi.fn();
vi.mock("@libsql/client/http", () => ({ createClient: () => ({ execute }) }));

const dir = mkdtempSync(join(tmpdir(), "local-reads-"));
const file = join(dir, "data.db");
let writer: DatabaseSync;

beforeAll(() => {
  writer = new DatabaseSync(file);
  writer.exec("PRAGMA journal_mode = WAL");
  writer.exec("CREATE TABLE t (a INTEGER, b TEXT, c REAL, flag INTEGER, d BLOB)");
  writer.exec("INSERT INTO t VALUES (1, 'one', 1.5, 1, x'0102'), (2, 'two', NULL, 0, NULL)");
});

afterEach(async () => {
  const { resetLocalReads } = await import("../localReads");
  await resetLocalReads();
  delete process.env.DATABASE_LOCAL_PATH;
  execute.mockReset();
  vi.resetModules();
});

afterAll(() => {
  writer.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("localRead", () => {
  it("gives rows as libSQL does: numbers, text, null, blobs as ArrayBuffer, the first of two same-named columns", async () => {
    const { localRead, objectsOf } = await import("../localReads");
    const r = objectsOf(await localRead(file, "SELECT a, b, c, d, a AS b FROM t ORDER BY a", [], 5000));
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ a: 1, b: "one", c: 1.5 });
    expect(r[0]?.d).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(r[0]?.d as ArrayBuffer)]).toEqual([1, 2]);
    expect(r[1]).toEqual({ a: 2, b: "two", c: null, d: null });
    expect(Object.keys(r[0] ?? {})).toEqual(["a", "b", "c", "d"]);
  });

  it("binds true and false as 1 and 0, as libSQL does", async () => {
    const { localRead, objectsOf } = await import("../localReads");
    expect(objectsOf(await localRead(file, "SELECT b FROM t WHERE flag = ?", [true], 5000))).toEqual([{ b: "one" }]);
    expect(objectsOf(await localRead(file, "SELECT b FROM t WHERE flag = ?", [false], 5000))).toEqual([{ b: "two" }]);
  });

  it("can't write", async () => {
    const { localRead } = await import("../localReads");
    await expect(localRead(file, "INSERT INTO t (a) VALUES (9)", [], 5000)).rejects.toThrow(/local read failed/);
    const n = writer.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number };
    expect(n.n).toBe(2);
  });

  it("sees a write committed after it opened", async () => {
    const { localRead, objectsOf } = await import("../localReads");
    await localRead(file, "SELECT COUNT(*) AS n FROM t", [], 5000);
    writer.exec("INSERT INTO t (a, b) VALUES (3, 'three')");
    expect(objectsOf(await localRead(file, "SELECT COUNT(*) AS n FROM t", [], 5000))).toEqual([{ n: 3 }]);
    writer.exec("DELETE FROM t WHERE a = 3");
  });

  it("counts a read's deadline from when it was asked, so a read stuck behind slow ones can't wait without end", async () => {
    const { LocalDeadlineError, localRead, objectsOf } = await import("../localReads");
    const forever = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n";
    // Both readers (DATABASE_LOCAL_WORKERS defaults to 2) busy for 3 s each.
    const slow = [localRead(file, forever, [], 3000), localRead(file, forever, [], 3000)];
    const asked = Date.now();
    await expect(localRead(file, "SELECT b FROM t WHERE a = ?", [1], 400)).rejects.toBeInstanceOf(LocalDeadlineError);
    expect(Date.now() - asked).toBeLessThan(2500);
    await Promise.allSettled(slow);
    expect(objectsOf(await localRead(file, "SELECT b FROM t WHERE a = ?", [2], 5000))).toEqual([{ b: "two" }]);
  });

  it("reads a database put in place of the old one, as a restore does, without a restart", async () => {
    const { localRead, objectsOf } = await import("../localReads");
    const live = join(dir, "restore-target.db");
    const make = (path: string, v: string) => {
      const db = new DatabaseSync(path);
      db.exec(`CREATE TABLE r (v TEXT); INSERT INTO r VALUES ('${v}')`);
      db.close();
    };
    make(live, "before");
    expect(objectsOf(await localRead(live, "SELECT v FROM r", [], 5000))).toEqual([{ v: "before" }]);
    const restored = join(dir, "restore.db");
    make(restored, "restored");
    renameSync(restored, live);
    expect(objectsOf(await localRead(live, "SELECT v FROM r", [], 5000))).toEqual([{ v: "restored" }]);
  });

  it("stops a read at its deadline and keeps serving after", async () => {
    const { LocalDeadlineError, localRead, objectsOf } = await import("../localReads");
    const forever = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n";
    await expect(localRead(file, forever, [], 300)).rejects.toBeInstanceOf(LocalDeadlineError);
    expect(objectsOf(await localRead(file, "SELECT b FROM t WHERE a = ?", [2], 5000))).toEqual([{ b: "two" }]);
  });
});

describe("the read layer", () => {
  it("reads the file when DATABASE_LOCAL_PATH is set, and never calls sqld", async () => {
    process.env.DATABASE_URL = "http://127.0.0.1:8080";
    process.env.DATABASE_AUTH_TOKEN = "test-token";
    process.env.DATABASE_LOCAL_PATH = file;
    const { rows } = await import("../client");
    expect(await rows("SELECT a, b FROM t WHERE a = ?", [1])).toEqual([{ a: 1, b: "one" }]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("reads through sqld when the file can't be read", async () => {
    process.env.DATABASE_URL = "http://127.0.0.1:8080";
    process.env.DATABASE_AUTH_TOKEN = "test-token";
    process.env.DATABASE_LOCAL_PATH = join(dir, "missing", "data.db");
    execute.mockResolvedValue({ columns: ["a", "b"], rows: [{ a: 1, b: "one" }], rowsAffected: 0 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rows } = await import("../client");
    expect(await rows("SELECT a, b FROM t WHERE a = ?", [1])).toEqual([{ a: 1, b: "one" }]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("fell back to sqld"))).toBe(true);
    warn.mockRestore();
  });

  it("reads through sqld when the setting is unset, as on every build machine", async () => {
    process.env.DATABASE_URL = "http://127.0.0.1:8080";
    process.env.DATABASE_AUTH_TOKEN = "test-token";
    execute.mockResolvedValue({ columns: ["a"], rows: [{ a: 7 }], rowsAffected: 0 });
    const { rows } = await import("../client");
    expect(await rows("SELECT 7 AS a")).toEqual([{ a: 7 }]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
